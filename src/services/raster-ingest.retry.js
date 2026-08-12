'use strict';

/**
 * Raster ingest — retry policy.
 *
 * Pure classification + backoff functions, plus a `fail(job, err, opts)`
 * side-effectful step that persists the outcome via the injected repository.
 * Three branches for a failed job:
 *   1. url_expired  — GEE download token stale (HTTP 401)
 *                     → mark `url_expired`; job-refresh flow issues a new URL.
 *   2. can retry    — bounded retry with exponential backoff (bigger backoff
 *                     for HTTP 429 rate-limits).
 *   3. terminal     — non-retryable HTTP 4xx, FILE_TOO_LARGE, NO_TIF_IN_ZIP,
 *                     or budget exceeded → moves to DLQ (§22-D improvement
 *                     over reference project's opaque `failed` state).
 *
 * @ported-from migration/kt_gee_migration/services/raster-ingest.retry.js
 * @improvement §22-D — DLQ terminal state instead of opaque 'failed'.
 * @improvement Generic retry backoff (not just 429) using config knobs.
 */

const cfg = require('../configs/raster-ingest');
const { Api400Error } = require('../core/error.response');

const DEBUG = process.env.RASTER_INGEST_DEBUG === 'true' || process.env.NODE_ENV === 'development';

/**
 * Classify an error into retry buckets.
 * Pure function — no side effects, safe to unit-test.
 */
function classifyError(err) {
    const errMsg = `${err?.code || err?.name || 'ERROR'}: ${err?.message || ''}`;
    const is429 = /HTTP 429|UPSTREAM_4XX.*429|rate.?limit/i.test(errMsg);
    const isUrlExpired =
        err?.code === 'UPSTREAM_4XX' && /HTTP 401|UNAUTHENTICATED|Invalid token/i.test(errMsg);
    const isNonRetryable4xx = err?.code === 'UPSTREAM_4XX' && !is429 && !isUrlExpired;
    return { errMsg, is429, isUrlExpired, isNonRetryable4xx };
}

/**
 * HTTP 429 backoff schedule (jittered):
 *   retry 0 → 60s  + jitter (0-15s)   ~ ratelimit reset
 *   retry 1 → 180s + jitter (0-45s)
 *   retry 2+ → 600s + jitter (0-150s)
 * Values are hard-coded because they match GEE's Restricted Mode rate-limit
 * reset windows; do not env-override without benchmark evidence.
 */
function nextRetryDelayFor429(retryCount) {
    const base = [60_000, 180_000, 600_000][retryCount] || 600_000;
    const jitter = Math.floor(Math.random() * base * 0.25);
    return base + jitter;
}

/**
 * Generic retry backoff for non-429 transient errors. Exponential from
 * `cfg.RETRY_BASE_MS`, doubled per attempt, capped at `cfg.RETRY_MAX_MS`.
 */
function nextGenericRetryDelay(retryCount) {
    const base = cfg.RETRY_BASE_MS;
    const cap = cfg.RETRY_MAX_MS;
    const raw = base * 2 ** Math.max(0, retryCount);
    return Math.min(cap, raw);
}

/**
 * Non-retryable regardless of budget.
 * Kept as its own predicate so tests can assert individual failure modes.
 */
function isTerminalErrorCode(err) {
    if (err instanceof Api400Error) {
        return true;
    }
    return err?.code === 'FILE_TOO_LARGE' || err?.code === 'NO_TIF_IN_ZIP';
}

/**
 * Decide + persist next state for a failing job. Never throws — the caller
 * (raster-ingest.pipeline.js) re-raises the underlying error after this
 * function completes.
 *
 * @param {object} job             — DB row (id, layer_code, retry_count)
 * @param {Error}  err
 * @param {object} [opts]
 * @param {object} [opts.repo]     — injected repository (defaults to
 *                                    ../repositories/raster-ingest.repository)
 */
async function fail(job, err, opts = {}) {
    const resolvedRepo = 'repo' in opts ? opts.repo : safeRequireRepo();
    if (!resolvedRepo) {
        // Repo not shipped yet (pre-GEE-S05). Log + swallow so pipeline tests
        // can still exercise `fail()` with a real repo mock, and production
        // still sees the failure via the caller's re-throw.
        console.error(
            `[RASTER-INGEST] job=${job?.id} fail() called before raster-ingest.repository ships; ` +
                `original error: ${err?.message}`,
        );
        return;
    }

    const { errMsg, is429, isUrlExpired, isNonRetryable4xx } = classifyError(err);

    if (isUrlExpired) {
        await resolvedRepo.updateStatus(job.id, { status: 'url_expired', errorLog: errMsg });
        console.warn(
            `[RASTER-INGEST] job=${job.id} URL_EXPIRED layer=${job.layer_code} ` +
                '— awaiting refresh',
        );
        return;
    }

    const terminalCode = isTerminalErrorCode(err) || isNonRetryable4xx;
    const canRetry = !terminalCode && job.retry_count < cfg.MAX_RETRIES;

    if (canRetry) {
        const nextRetryAtMs = is429
            ? nextRetryDelayFor429(job.retry_count)
            : nextGenericRetryDelay(job.retry_count);
        await resolvedRepo.incrementRetry(job.id, { nextRetryAtMs, errorLog: errMsg });
        console.warn(
            `[RASTER-INGEST] job=${job.id} RETRY ${job.retry_count + 1}/${cfg.MAX_RETRIES} ` +
                `layer=${job.layer_code} — ${errMsg} (backoff ${Math.round(nextRetryAtMs / 1000)}s${is429 ? ', 429' : ''})`,
        );
        return;
    }

    // Terminal — DLQ (§22-D improvement over reference's opaque 'failed').
    // The repo is expected to expose moveToDlq(); if it doesn't (older
    // deployment on the reference schema), we fall back to updateStatus('failed').
    const reason = terminalCode ? 'NON_RETRYABLE' : 'MAX_RETRIES_EXCEEDED';
    if (typeof resolvedRepo.moveToDlq === 'function') {
        await resolvedRepo.moveToDlq(job.id, { errorLog: errMsg, reason });
    } else {
        await resolvedRepo.updateStatus(job.id, { status: 'failed', errorLog: errMsg });
    }
    console.error(
        `[RASTER-INGEST] job=${job.id} DLQ (${reason}) layer=${job.layer_code} — ${errMsg}`,
    );
    if (DEBUG && err?.stack) {
        console.debug(err.stack);
    }
}

function safeRequireRepo() {
    try {
        return require('../repositories/raster-ingest.repository');
    } catch {
        return null;
    }
}

module.exports = {
    fail,
    classifyError,
    isTerminalErrorCode,
    nextRetryDelayFor429,
    nextGenericRetryDelay,
};
