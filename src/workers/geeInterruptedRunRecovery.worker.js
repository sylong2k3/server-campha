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
    return { floodRepo, ingestRepo, floodRepoLoadError };
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
 * @param {() => {floodRepo, ingestRepo, floodRepoLoadError}} [opts.repoLoader]
 * @returns {Promise<{runs: number, ingestJobs: number}>}
 */
async function recoverInterruptedRuns({ repoLoader = defaultRepoLoader } = {}) {
    const { floodRepo, ingestRepo, floodRepoLoadError } = repoLoader();
    if (!floodRepo) {
        const detail = floodRepoLoadError?.code || floodRepoLoadError?.message || 'not installed';
        console.info(
            `[GEE-RECOVERY] flood_analysis_run repository not present yet (${detail}); skipping run recovery.`,
        );
        return { runs: 0, ingestJobs: 0 };
    }
    const repo = floodRepo;

    let orphanedRuns = [];
    let orphanedIngestJobs = 0;
    try {
        // Repository is expected to expose:
        //   failInterruptedActiveRuns() → Array<{id, module, analysis_key, attempt_no, params_snapshot}>
        // The repo does the UPDATE inside a transaction and returns the rows
        // it actually mutated, so the return value is authoritative.
        orphanedRuns = await repo.failInterruptedActiveRuns({
            errorCode: 'INTERRUPTED_ON_RESTART',
        });
    } catch (error) {
        console.error(`[GEE-RECOVERY] failInterruptedActiveRuns error: ${error.message}`);
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

    if (orphanedRuns.length === 0 && orphanedIngestJobs === 0) {
        console.info('[GEE-RECOVERY] No interrupted flood runs or ingest jobs found.');
        return { runs: 0, ingestJobs: 0 };
    }

    console.warn(
        `[GEE-RECOVERY] Marked ${orphanedRuns.length} orphan flood analysis runs and ` +
            `${orphanedIngestJobs} orphan raster-ingest jobs as FAILED / requeued. ` +
            'Admin can review under /admin/flood/history.',
    );

    return { runs: orphanedRuns.length, ingestJobs: orphanedIngestJobs };
}

module.exports = { recoverInterruptedRuns };
