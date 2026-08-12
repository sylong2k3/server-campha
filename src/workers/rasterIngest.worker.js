'use strict';

/**
 * Raster ingest worker: cron poll + `FOR UPDATE SKIP LOCKED` claim.
 *
 * Multiple Node instances can run this worker safely — the DB-side
 * `SELECT ... FOR UPDATE SKIP LOCKED` in raster-ingest.repository.claimPending
 * makes the claim race-safe without any Redis lock or singleton gate.
 *
 * Overlap protection: `isRunning` prevents two ticks in the same process from
 * overlapping when a job takes longer than the poll cadence (large COG
 * downloads, GDAL translate).
 *
 * @ported-from migration/kt_gee_migration/workers/rasterIngest.worker.js
 * @adaptation Drops the reference project's S3 (gs-s3-geotiff) status check;
 *             this server uses the GeoServer FileSystem mirror per §41.
 */

const cron = require('node-cron');
const os = require('os');

const cfg = require('../configs/raster-ingest');

const WORKER_ID = `raster-ingest-${os.hostname()}-${process.pid}`;
const DEBUG =
    process.env.RASTER_INGEST_DEBUG === 'true' || process.env.NODE_ENV === 'development';

// Module-level state — startWorker() may be called at most once per process.
let cronJob = null;
let isRunning = false;
let ticksTotal = 0;
let ticksIdle = 0;

function safeRequireRepo() {
    try {
        return require('../repositories/raster-ingest.repository');
    } catch {
        return null;
    }
}

function safeRequireIngestService() {
    try {
        return require('../services/raster-ingest.service');
    } catch {
        return null;
    }
}

async function tick(opts = {}) {
    if (isRunning) {
        if (DEBUG) {console.debug(`[${WORKER_ID}] tick SKIPPED — previous still running`);}
        return { skipped: true };
    }
    isRunning = true;
    ticksTotal += 1;
    const t0 = Date.now();

    try {
        const rasterRepo = 'repo' in opts ? opts.repo : safeRequireRepo();
        const service = 'ingestSvc' in opts ? opts.ingestSvc : safeRequireIngestService();
        if (!rasterRepo?.claimPending || !service?.runJob) {
            if (DEBUG) {console.debug(`[${WORKER_ID}] tick skipped: repo or service not ready`);}
            return { skipped: true };
        }

        const jobs = await rasterRepo.claimPending({
            batchSize: cfg.CONCURRENCY,
            maxRetries: cfg.MAX_RETRIES,
        });
        if (!jobs?.length) {
            ticksIdle += 1;
            // Heartbeat every 60 idle ticks (~15 min at 15s poll) so ops can
            // see the worker is alive without log spam when the queue is empty.
            if (DEBUG && ticksIdle % 60 === 0) {
                console.debug(
                    `[${WORKER_ID}] IDLE — ${ticksIdle}/${ticksTotal} ticks empty`,
                );
            }
            return { claimed: 0 };
        }
        console.info(
            `[${WORKER_ID}] CLAIMED ${jobs.length} job(s): [${jobs.map((j) => j.id).join(', ')}]`,
        );

        const results = await Promise.allSettled(
            jobs.map(async (job) => {
                try {
                    await service.runJob(job);
                    return { id: job.id, ok: true };
                } catch (err) {
                    // Retry policy already recorded the status; log for
                    // per-worker audit.
                    console.error(
                        `[${WORKER_ID}] job=${job.id} THREW: ${err?.code || err?.name}: ${err?.message}`,
                    );
                    return { id: job.id, ok: false, error: err?.message };
                }
            }),
        );
        const ok = results.filter((r) => r.value?.ok).length;
        console.info(
            `[${WORKER_ID}] TICK done ${ok}/${jobs.length} ok in ${Date.now() - t0}ms`,
        );
        return { claimed: jobs.length, ok };
    } catch (err) {
        console.error(`[${WORKER_ID}] TICK ERROR: ${err?.code || err?.name}: ${err?.message}`);
        return { error: err?.message };
    } finally {
        isRunning = false;
    }
}

const startWorker = () => {
    if (!cfg.isEnabled()) {
        console.info(`[${WORKER_ID}] DISABLED (RASTER_INGEST_ENABLED=false)`);
        return { started: false, reason: 'DISABLED' };
    }
    if (cronJob) {
        console.warn(`[${WORKER_ID}] start called twice — ignored`);
        return { started: false, reason: 'ALREADY_STARTED' };
    }
    if (cfg.REQUESTED_CONCURRENCY !== cfg.CONCURRENCY) {
        console.warn(
            `[${WORKER_ID}] concurrency=${cfg.REQUESTED_CONCURRENCY} clamped to ` +
                `${cfg.CONCURRENCY} per architecture doc §24`,
        );
    }
    console.info(
        `[${WORKER_ID}] STARTED — poll="${cfg.WORKER_POLL_CRON}" ` +
            `concurrency=${cfg.CONCURRENCY} maxRetries=${cfg.MAX_RETRIES} debug=${DEBUG}`,
    );
    cronJob = cron.schedule(cfg.WORKER_POLL_CRON, () => tick(), {
        suppressMissedWarning: true,
    });
    return { started: true };
};

const stopWorker = () => {
    if (cronJob) {
        cronJob.stop();
        cronJob = null;
        console.info(
            `[${WORKER_ID}] STOPPED — total ticks=${ticksTotal} idle=${ticksIdle}`,
        );
    }
};

// Exposed for tests: reset module-level counters between suites.
const __resetForTests = () => {
    ticksTotal = 0;
    ticksIdle = 0;
    isRunning = false;
    if (cronJob) {
        cronJob.stop();
        cronJob = null;
    }
};

module.exports = { startWorker, stopWorker, tick, __resetForTests };
