'use strict';

/**
 * Configuration for the raster-ingest pipeline
 * (URL → SHA-256 verify → CRS validate → MinIO archive → GeoServer publish).
 *
 * Env vars are declared in configs/env.js so misconfiguration surfaces at
 * boot, not at first ingest.
 *
 * Design decisions:
 *   - The concurrency limit is hard-clamped to 1 in code. The env var
 *     `RASTER_INGEST_CONCURRENCY` is still parsed so ops can be warned at
 *     boot if someone tries to raise it — see architecture doc §22-A / §24.
 *   - Bucket selection is per-job (the caller passes a category name — the
 *     ingest service resolves it via configs/minioClient). No global default
 *     bucket lives in this file; the reference project's `MINIO_BUCKET_GEE_RASTER`
 *     fallback was a footgun for domain leakage.
 *   - S3 endpoint / key inlining is dropped — the current server reads MinIO
 *     credentials from mounted secret files, not env vars.
 *   - DLQ terminal state (§22-D fix) is enforced via MAX_ATTEMPTS in the
 *     retry module, not here — this file only holds knobs.
 *
 * @ported-from migration/kt_gee_migration/configs/raster-ingest.js
 */

const os = require('os');
const path = require('path');

const MB = 1024 * 1024;

const ENABLED = String(process.env.RASTER_INGEST_ENABLED || 'false').toLowerCase() === 'true';
// `isEnabled` reads env at call time so callers stay tunable without a module
// reset. `ENABLED` is kept for callers that want the boot-time snapshot.
const isEnabledAtCallTime = () =>
    String(process.env.RASTER_INGEST_ENABLED || 'false').toLowerCase() === 'true';

const TMP_DIR = process.env.RASTER_INGEST_TMP_DIR || path.join(os.tmpdir(), 'campha_raster_ingest');

const MAX_BYTES = Number(process.env.RASTER_INGEST_MAX_MB || 3072) * MB;

const FETCH_TIMEOUT_MS = Number(process.env.RASTER_INGEST_FETCH_TIMEOUT_MS || 900_000);

// Retry budget. After MAX_RETRIES failed attempts the job moves to DLQ per
// architecture doc §22-D / §77.
const MAX_RETRIES = Number(process.env.RASTER_INGEST_MAX_RETRIES || 3);

// Exponential backoff for transient failures: `base * 2^attempt`, capped.
const RETRY_BASE_MS = Number(process.env.RASTER_INGEST_RETRY_BASE_MS || 15_000);
const RETRY_MAX_MS = Number(process.env.RASTER_INGEST_RETRY_MAX_MS || 120_000);

const parsedConcurrency = Number.parseInt(process.env.RASTER_INGEST_CONCURRENCY, 10);
const REQUESTED_CONCURRENCY = Number.isFinite(parsedConcurrency)
    ? Math.max(1, parsedConcurrency)
    : 1;
const CONCURRENCY = 1;

// GDAL translate cache (MB) — used when the reference pipeline shells out to
// gdal_translate / gdalwarp for COG conversion or CRS validation.
const GDAL_CACHEMAX_MB = Number(process.env.GDAL_CACHEMAX_MB || 512);

// When true (default), the pipeline REQUIRES gdalinfo + gdal_translate on
// PATH. Set to 'false' on hosts without GDAL (e.g. bare Windows VPS) to make
// the pipeline skip CRS validation + COG conversion; the raw TIFF from GEE
// gets uploaded as-is. Trade-off: we lose the §22-F CRS safety gate — trust
// GEE's output CRS blindly.
const REQUIRE_GDAL =
    String(process.env.RASTER_INGEST_REQUIRE_GDAL || 'true').toLowerCase() === 'true';

// Worker poll cadence.
const WORKER_POLL_CRON = process.env.RASTER_INGEST_WORKER_POLL_CRON || '*/15 * * * * *';

// Default `isEnabled` follows call-time env so tests can toggle it without a
// module reset. Existing consumers that rely on the boot-time snapshot can
// still read `ENABLED` directly.
const isEnabled = isEnabledAtCallTime;

const summariseConfig = () => ({
    enabled: ENABLED,
    tmpDir: TMP_DIR,
    maxBytes: MAX_BYTES,
    fetchTimeoutMs: FETCH_TIMEOUT_MS,
    maxRetries: MAX_RETRIES,
    retryBaseMs: RETRY_BASE_MS,
    retryMaxMs: RETRY_MAX_MS,
    concurrency: CONCURRENCY,
    requestedConcurrency: REQUESTED_CONCURRENCY,
    gdalCacheMaxMb: GDAL_CACHEMAX_MB,
    requireGdal: REQUIRE_GDAL,
    workerPollCron: WORKER_POLL_CRON,
});

module.exports = {
    ENABLED,
    TMP_DIR,
    MAX_BYTES,
    FETCH_TIMEOUT_MS,
    MAX_RETRIES,
    RETRY_BASE_MS,
    RETRY_MAX_MS,
    CONCURRENCY,
    REQUESTED_CONCURRENCY,
    GDAL_CACHEMAX_MB,
    REQUIRE_GDAL,
    WORKER_POLL_CRON,
    isEnabled,
    summariseConfig,
};
