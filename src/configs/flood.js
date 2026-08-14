'use strict';

/**
 * Flood/Hydrology domain runtime config.
 *
 * Env values themselves are validated in configs/env.js at boot; this module
 * only aggregates them into named helpers so services and jobs can read one
 * source of truth (matching the shape of configs/raster-ingest.js).
 *
 * Bucket resolution is delegated to configs/minioClient — the `flood-rasters`
 * and `flood-calibration` categories are declared in its
 * OPTIONAL_CATEGORY_BUCKET_ENV map. This module only decides WHICH category
 * the current run mode maps to.
 *
 * @see docs/GEE_FLOOD_INTEGRATION_ARCHITECTURE.md §5, §7.2
 */

const minio = require('./minioClient');

// ── Debug flag ──────────────────────────────────────────────────────────────
// Consulted per-call by services/flood/debug.util.js so ops can flip it
// without restarting (change env in the process, or restart with FLOOD_DEBUG=true).
const isDebugEnabled = () => String(process.env.FLOOD_DEBUG || 'false').toLowerCase() === 'true';

const readBool = (name, fallback) => {
    const raw = process.env[name];
    if (raw === undefined || raw === null || raw === '') {
        return fallback;
    }
    return String(raw).toLowerCase() === 'true';
};

const readNumber = (name, fallback) => {
    const value = Number(process.env[name]);
    return Number.isFinite(value) && value > 0 ? value : fallback;
};

// ── Ingest polling (run-executor waits for raster ingest to finish) ─────────
const ingest = () => ({
    waitTimeoutMs: readNumber('FLOOD_INGEST_WAIT_TIMEOUT_MS', 25 * 60 * 1000),
    pollIntervalMs: readNumber('FLOOD_INGEST_POLL_INTERVAL_MS', 2000),
});

// ── Bucket category selection ───────────────────────────────────────────────
// Product artefacts go to `flood-rasters` (publishable). Calibration artefacts
// go to `flood-calibration` (archive-only per §19 — never auto-published).
const BUCKET_BY_MODE = Object.freeze({
    product: 'flood-rasters',
    calibration: 'flood-calibration',
});

const bucketCategoryForMode = (mode) => BUCKET_BY_MODE[mode] || BUCKET_BY_MODE.product;

const hasBucketForMode = (mode) => minio.hasBucketCategory(bucketCategoryForMode(mode));

// ── M5 trend scheduler ──────────────────────────────────────────────────────
// Trend is heavy (multi-period, 10 m analysis scale) and opt-in per deployment.
const trendCron = () => ({
    enabled: readBool('FLOOD_TREND_ENABLED', false),
    expression: process.env.FLOOD_TREND_CRON || '0 2 1 1,4,7,10 *',
    timezone: process.env.FLOOD_TREND_CRON_TZ || 'Asia/Ho_Chi_Minh',
    catchupEnabled: readBool('FLOOD_TREND_CATCHUP_ENABLED', false),
    catchupDelayMs: readNumber('FLOOD_TREND_CATCHUP_DELAY_MS', 120_000),
    mode: process.env.FLOOD_TREND_MODE === 'calibration' ? 'calibration' : 'product',
});

const isTrendCronEnabled = () => trendCron().enabled;

// ── Snapshot for /admin/flood/dashboard-style diagnostics ───────────────────
const summariseConfig = () => ({
    ingest: ingest(),
    buckets: {
        product: BUCKET_BY_MODE.product,
        calibration: BUCKET_BY_MODE.calibration,
        productConfigured: minio.hasBucketCategory(BUCKET_BY_MODE.product),
        calibrationConfigured: minio.hasBucketCategory(BUCKET_BY_MODE.calibration),
    },
    trend: trendCron(),
    debug: isDebugEnabled(),
});

module.exports = {
    ingest,
    bucketCategoryForMode,
    hasBucketForMode,
    trendCron,
    isTrendCronEnabled,
    isDebugEnabled,
    summariseConfig,
    BUCKET_BY_MODE,
};
