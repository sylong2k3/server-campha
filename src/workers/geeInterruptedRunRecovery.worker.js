'use strict';

/**
 * Startup recovery for flood analysis runs interrupted by a process crash.
 *
 * The point (see architecture doc §76): when the runtime restarts, any rows
 * in `gis.flood_analysis_runs` with a live status (QUEUED / COMPUTING /
 * EXPORTING / HARVESTING / VALIDATING / ARCHIVING / PUBLISHING) are orphaned —
 * their owner process is gone. Marking them FAILED immediately (with a
 * distinct error_code so audit can distinguish "actually failed" from
 * "process restart") avoids waiting on watchdogs and lets the admin re-submit.
 *
 * We DO NOT overwrite completed history: successful attempts remain intact and
 * a rerun becomes a fresh attempt row (§47).
 *
 * Similarly, raster-ingest jobs stuck mid-pipeline are rewound to `pending`
 * (or FAILED / DLQ if they've exceeded the retry budget) so the ingest worker
 * can pick them up on its normal poll.
 *
 * @ported-from migration/kt_gee_migration/workers/geeInterruptedRunRecovery.worker.js
 * @depends-on gis.flood_analysis_runs (GEE-S05 migration)
 * @depends-on gis.raster_ingest_jobs (GEE-S04 migration)
 */

/**
 * Default repository loader — lazy-requires so the file stays importable
 * before GEE-S04/S05 land the persistence layer. Tests can pass their own
 * loader via the `recoverInterruptedRuns({ repoLoader })` option.
 */
function defaultRepoLoader() {
    let floodRepo = null;
    let ingestRepo;
    let forestRepo;
    let rasterPublisher;
    let floodRepoLoadError = null;
    try {
        floodRepo = require('../repositories/flood-analysis-run.repository');
    } catch (error) {
        floodRepoLoadError = error;
    }
    try {
        ingestRepo = require('../repositories/raster-ingest.repository');
    } catch {
        ingestRepo = null;
    }
    try {
        forestRepo = require('../repositories/forest-classification.repository');
        rasterPublisher = require('../services/raster-ingest.publish');
    } catch {
        forestRepo = null;
        rasterPublisher = null;
    }
    return { floodRepo, ingestRepo, forestRepo, rasterPublisher, floodRepoLoadError };
}

const ACTIVE_INGEST_STATES = new Set([
    'pending',
    'downloading',
    'validating',
    'uploading',
    'publishing',
]);

function rasterIngestJobId(snapshot) {
    let summary = snapshot?.province_summary;
    if (typeof summary === 'string') {
        try {
            summary = JSON.parse(summary);
        } catch {
            return null;
        }
    }
    const id = Number(summary?.rasterIngestJobId);
    return Number.isInteger(id) && id > 0 ? id : null;
}

async function failForestSnapshot(forestRepo, snapshot, reason) {
    await forestRepo.updateRun(snapshot.id, {
        status: 'failed',
        errorMessage: String(reason).slice(0, 1000),
    });
}

async function recoverForestSnapshots({ forestRepo, ingestRepo, rasterPublisher }) {
    if (!forestRepo || typeof forestRepo.listActiveRuns !== 'function') {
        return 0;
    }

    const snapshots = await forestRepo.listActiveRuns();
    let recovered = 0;
    for (const snapshot of snapshots) {
        try {
            if (snapshot.status !== 'exporting') {
                await failForestSnapshot(
                    forestRepo,
                    snapshot,
                    'Forest classification was interrupted by a server restart. Run this period again.',
                );
                recovered += 1;
                continue;
            }

            const jobId = rasterIngestJobId(snapshot);
            if (!jobId) {
                await failForestSnapshot(
                    forestRepo,
                    snapshot,
                    'Forest raster publication was interrupted and has no linked ingest job. Run this period again.',
                );
                recovered += 1;
                continue;
            }

            if (!ingestRepo || typeof ingestRepo.findById !== 'function') {
                console.warn(
                    `[GEE-RECOVERY] Cannot inspect raster-ingest job ${jobId} for forest snapshot ${snapshot.id}.`,
                );
                continue;
            }

            const job = await ingestRepo.findById(jobId);
            if (job && ACTIVE_INGEST_STATES.has(job.status)) {
                // The ingest recovery above has either left a pending job alone
                // or rewound a mid-pipeline job. Its worker will finish the backlink.
                continue;
            }

            if (
                job?.status === 'completed' &&
                job.geoserver_layer &&
                rasterPublisher &&
                typeof rasterPublisher.backLinkResource === 'function'
            ) {
                const linked = await rasterPublisher.backLinkResource(
                    { type: 'forest_snapshot', id: snapshot.id },
                    {
                        geoserverLayer: job.geoserver_layer,
                        geoserverStore: job.geoserver_store,
                        minioCategory: job.minio_category,
                        minioKey: job.minio_key,
                        rasterIngestJobId: job.id,
                        published: true,
                    },
                );
                if (linked?.rowCount !== 1) {
                    throw new Error(`forest snapshot ${snapshot.id} was not back-linked`);
                }
                recovered += 1;
                continue;
            }

            const jobState = job
                ? `linked ingest job ${job.id} is ${job.status}`
                : 'linked ingest job is missing';
            await failForestSnapshot(
                forestRepo,
                snapshot,
                `Forest raster publication was interrupted; ${jobState}. Run this period again.`,
            );
            recovered += 1;
        } catch (error) {
            console.error(
                `[GEE-RECOVERY] forest snapshot ${snapshot.id} recovery error: ${error.message}`,
            );
        }
    }
    return recovered;
}

/**
 * Recover interrupted flood analysis runs and raster-ingest jobs.
 *
 * Called ONCE from server.js after the singleton advisory lock is acquired,
 * before any cron / queue / worker starts. Returns a summary the startup
 * banner can log. Never throws — the server MUST start even when recovery
 * fails; unrecoverable state surfaces to admins via the system log.
 *
 * @param {object} [opts]
 * @param {() => {floodRepo, ingestRepo, forestRepo, rasterPublisher, floodRepoLoadError}} [opts.repoLoader]
 * @returns {Promise<{runs: number, ingestJobs: number, forestSnapshots: number}>}
 */
async function recoverInterruptedRuns({ repoLoader = defaultRepoLoader } = {}) {
    const { floodRepo, ingestRepo, forestRepo, rasterPublisher, floodRepoLoadError } = repoLoader();
    if (!floodRepo) {
        const detail = floodRepoLoadError?.code || floodRepoLoadError?.message || 'not installed';
        console.info(
            `[GEE-RECOVERY] flood_analysis_run repository not present yet (${detail}); skipping run recovery.`,
        );
    }

    let orphanedRuns = [];
    let orphanedIngestJobs = 0;
    let recoveredForestSnapshots = 0;
    if (floodRepo) {
        try {
            // Repository is expected to expose:
            //   failInterruptedActiveRuns() → Array<{id, module, analysis_key, attempt_no, params_snapshot}>
            // The repo does the UPDATE inside a transaction and returns the rows
            // it actually mutated, so the return value is authoritative.
            orphanedRuns = await floodRepo.failInterruptedActiveRuns({
                errorCode: 'INTERRUPTED_ON_RESTART',
            });
        } catch (error) {
            console.error(`[GEE-RECOVERY] failInterruptedActiveRuns error: ${error.message}`);
        }
    }

    if (ingestRepo) {
        try {
            // Expected shape:
            //   recoverInterruptedJobs({ maxRetries }) → number of jobs affected
            // Contract: jobs mid-pipeline are rewound to `pending` unless they
            // have exceeded retries, in which case they move to FAILED / DLQ.
            orphanedIngestJobs = await ingestRepo.recoverInterruptedJobs({
                errorCode: 'INTERRUPTED_ON_RESTART',
            });
        } catch (error) {
            console.error(`[GEE-RECOVERY] recoverInterruptedJobs error: ${error.message}`);
        }
    }

    try {
        recoveredForestSnapshots = await recoverForestSnapshots({
            forestRepo,
            ingestRepo,
            rasterPublisher,
        });
    } catch (error) {
        console.error(`[GEE-RECOVERY] recoverForestSnapshots error: ${error.message}`);
    }

    if (orphanedRuns.length === 0 && orphanedIngestJobs === 0 && recoveredForestSnapshots === 0) {
        console.info('[GEE-RECOVERY] No interrupted flood, forest, or ingest jobs found.');
        return { runs: 0, ingestJobs: 0, forestSnapshots: 0 };
    }

    console.warn(
        `[GEE-RECOVERY] Marked ${orphanedRuns.length} orphan flood analysis runs and ` +
            `${orphanedIngestJobs} orphan raster-ingest jobs as FAILED / requeued; ` +
            `recovered ${recoveredForestSnapshots} forest snapshots. ` +
            'Admin can review under /admin/flood/history.',
    );

    return {
        runs: orphanedRuns.length,
        ingestJobs: orphanedIngestJobs,
        forestSnapshots: recoveredForestSnapshots,
    };
}

module.exports = { recoverInterruptedRuns };
