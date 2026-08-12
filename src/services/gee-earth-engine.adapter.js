'use strict';

/**
 * Single adapter around @google/earthengine.
 *
 * Domain code (services/flood/**) MUST use this adapter and never touch
 * `ee.data.*` or the raw `ee` object directly. This gives us one place to add
 * timeouts, retries, logging, and structured errors — and lets unit tests
 * substitute a fake by mocking this module.
 *
 * See @docs/GEE_FLOOD_INTEGRATION_ARCHITECTURE.md §23 for the design rationale.
 */

const { ee, initializeEarthEngine, isInitialized } = require('../configs/gge');
const { EarthEngineError } = require('../core/error.response');

const EVALUATE_TIMEOUT_MS = Math.max(
    1000,
    Number.parseInt(process.env.GEE_EVALUATE_TIMEOUT_MS, 10) || 5 * 60 * 1000,
);
const POLL_INTERVAL_MS = Math.max(
    1000,
    Number.parseInt(process.env.GEE_POLL_INTERVAL_MS, 10) || 30 * 1000,
);
const POLL_MAX_ATTEMPTS = Math.max(1, Number.parseInt(process.env.GEE_POLL_MAX_ATTEMPTS, 10) || 40);
const MAP_ID_TIMEOUT_MS = Math.max(
    1000,
    Number.parseInt(process.env.GEE_MAP_ID_TIMEOUT_MS, 10) || 60 * 1000,
);

// ── Error normalisation ───────────────────────────────────────────────────────

const wrapError = (error, fallback) => {
    if (error instanceof EarthEngineError) {
        return error;
    }
    const message =
        (error && (error.message || error.error?.message)) ||
        (typeof error === 'string' ? error : fallback);
    const wrapped = new EarthEngineError(message || fallback, [error?.code || 'GEE_ERROR']);
    if (error?.stack) {
        wrapped.stack = error.stack;
    }
    return wrapped;
};

// ── Initialisation gate ───────────────────────────────────────────────────────

/**
 * Ensure the Earth Engine SDK has been authenticated + initialised. Idempotent.
 * The underlying implementation caches state and only runs the auth handshake
 * once per process (see configs/gge.js).
 */
async function ensureInitialized(options = {}) {
    if (isInitialized()) {
        return;
    }
    try {
        await initializeEarthEngine(options);
    } catch (error) {
        throw wrapError(error, 'Earth Engine initialisation failed');
    }
}

// ── Async wrappers around ee callbacks ────────────────────────────────────────

const withTimeout = (fn, timeoutMs, label) =>
    new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            reject(
                new EarthEngineError(`${label} timed out after ${timeoutMs}ms`, ['GEE_TIMEOUT']),
            );
        }, timeoutMs);
        try {
            fn(
                (value) => {
                    clearTimeout(timer);
                    resolve(value);
                },
                (error) => {
                    clearTimeout(timer);
                    reject(wrapError(error, `${label} failed`));
                },
            );
        } catch (error) {
            clearTimeout(timer);
            reject(wrapError(error, `${label} threw synchronously`));
        }
    });

/**
 * Promisified `eeObject.evaluate(cb)` — the async server-side computation.
 * Rejects with EarthEngineError on timeout.
 */
async function evaluate(eeObject, { timeoutMs = EVALUATE_TIMEOUT_MS } = {}) {
    await ensureInitialized();
    return withTimeout(
        (resolve, reject) =>
            eeObject.evaluate((result, err) => (err ? reject(err) : resolve(result))),
        timeoutMs,
        'ee.evaluate',
    );
}

/**
 * Promisified `eeObject.getInfo(cb)`. Prefer `evaluate()` for anything that
 * touches the server; `getInfo()` blocks the SDK on synchronous work. Only use
 * for tiny client-side metadata objects (`ee.Number`, `ee.String` literals).
 */
async function getInfo(eeObject, { timeoutMs = EVALUATE_TIMEOUT_MS } = {}) {
    await ensureInitialized();
    return withTimeout(
        (resolve, reject) =>
            eeObject.getInfo((result, err) => (err ? reject(err) : resolve(result))),
        timeoutMs,
        'ee.getInfo',
    );
}

// ── Map tile IDs (preview only) ───────────────────────────────────────────────

/**
 * Get a GEE map tile handle for interactive preview. Optional `visParams` are
 * baked in via `ee.Image.visualize()` to avoid SDK CSV-encoding of numeric
 * arrays.
 *
 * Returns `{ mapId, token, tileUrl }`. NOTE: this is a temporary preview only —
 * production publication MUST go through Export → GCS → MinIO → GeoServer
 * (architecture doc §27–§31). Do not persist the tile URL.
 */
async function getMapId(image, visParams = {}) {
    await ensureInitialized();
    const finalImage =
        visParams && Object.keys(visParams).length > 0 ? image.visualize(visParams) : image;
    return withTimeout(
        (resolve, reject) =>
            ee.data.getMapId({ image: finalImage }, (mapInfo, err) => {
                if (err) {
                    return reject(err);
                }
                const mapId = mapInfo.mapid || mapInfo.name || '';
                const token = mapInfo.token || '';
                const tileUrl = token
                    ? `https://earthengine.googleapis.com/map/${mapId}/{z}/{x}/{y}?token=${token}`
                    : `https://earthengine.googleapis.com/v1alpha/${mapId}/tiles/{z}/{x}/{y}`;
                resolve({ mapId, token, tileUrl });
            }),
        MAP_ID_TIMEOUT_MS,
        'ee.data.getMapId',
    );
}

/**
 * Get a short-lived GCS-signed download URL for a small image. Used only as a
 * FALLBACK when Cloud Storage export is not configured (architecture doc §29).
 * The URL is not authoritative persistence — the raster-ingest pipeline must
 * still archive the download to MinIO.
 */
async function getDownloadUrl(image, params = {}) {
    await ensureInitialized();
    return withTimeout(
        (resolve, reject) => {
            const url = image.getDownloadURL(params, (result, err) =>
                err ? reject(err) : resolve(result || url),
            );
            // Some SDK builds return the URL synchronously and ignore the callback.
            if (typeof url === 'string' && url.length > 0) {
                resolve(url);
            }
        },
        EVALUATE_TIMEOUT_MS,
        'ee.Image.getDownloadURL',
    );
}

// ── GCS export (the production path) ──────────────────────────────────────────

/**
 * Submit an Export.image.toCloudStorage task. Returns `{ taskId, taskName }`.
 * The caller polls via `pollExportTask()`; do not block the HTTP request on
 * completion — a full export can take 10+ minutes.
 *
 * @param {object} opts
 * @param {ee.Image} opts.image
 * @param {string}   opts.description — human-readable task label
 * @param {string}   opts.bucket      — GCS bucket
 * @param {string}   opts.fileNamePrefix
 * @param {ee.Geometry} opts.region
 * @param {number}   opts.scale       — metres per pixel
 * @param {string}   [opts.crs='EPSG:32648']
 * @param {number}   [opts.maxPixels=1e10]
 * @param {object}   [opts.formatOptions] — e.g. { cloudOptimized: true }
 */
async function submitExportToCloudStorage({
    image,
    description,
    bucket,
    fileNamePrefix,
    region,
    scale,
    crs = 'EPSG:32648',
    maxPixels = 1e10,
    formatOptions = { cloudOptimized: true },
} = {}) {
    if (!image) {
        throw new EarthEngineError('image is required', ['GEE_BAD_ARG']);
    }
    if (!bucket) {
        throw new EarthEngineError('bucket is required', ['GEE_BAD_ARG']);
    }
    if (!description) {
        throw new EarthEngineError('description is required', ['GEE_BAD_ARG']);
    }
    await ensureInitialized();

    const task = ee.batch.Export.image.toCloudStorage({
        image,
        description,
        bucket,
        fileNamePrefix,
        region,
        scale,
        crs,
        maxPixels,
        formatOptions,
    });

    return withTimeout(
        (resolve, reject) =>
            task.start(
                () =>
                    resolve({
                        taskId: task.id,
                        taskName: `projects/earthengine-legacy/operations/${task.id}`,
                    }),
                (err) => reject(err),
            ),
        MAP_ID_TIMEOUT_MS,
        'ee.batch.Export.image.toCloudStorage.start',
    );
}

/**
 * Poll a submitted export task until it reaches a terminal state.
 * Returns `{ state: 'COMPLETED' | 'FAILED' | 'CANCELLED' | 'TIMEOUT', metadata?, error? }`.
 *
 * Terminal states are checked BEFORE `op.done` because a cancelled task has
 * `done: true` AND `metadata.state === 'CANCELLED'` — testing `done` first
 * would misclassify it as COMPLETED (reference implementation gets this right).
 */
async function pollExportTask(
    taskName,
    { intervalMs = POLL_INTERVAL_MS, maxAttempts = POLL_MAX_ATTEMPTS } = {},
) {
    if (!taskName) {
        throw new EarthEngineError('taskName is required', ['GEE_BAD_ARG']);
    }
    await ensureInitialized();

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, intervalMs));
        const ops = await listOperations([taskName]);
        const op = ops?.[0];
        const state = op?.metadata?.state;
        if (state === 'CANCELLED') {
            return { state: 'CANCELLED', metadata: op.metadata };
        }
        if (state === 'FAILED' || op?.error) {
            return {
                state: 'FAILED',
                metadata: op?.metadata,
                error: op?.error?.message || 'GEE task failed',
            };
        }
        if (op?.done) {
            return { state: 'COMPLETED', metadata: op.metadata };
        }
    }
    return { state: 'TIMEOUT' };
}

/**
 * Fetch operation records for the given task names. Wraps `ee.data.listOperations`
 * through `evaluate()` so timeouts are consistent.
 */
async function listOperations(taskNames) {
    await ensureInitialized();
    return evaluate(ee.data.listOperations(taskNames));
}

/**
 * Cancel a running/queued export task. No-op if the task is already terminal.
 */
async function cancelOperation(taskName) {
    if (!taskName) {
        throw new EarthEngineError('taskName is required', ['GEE_BAD_ARG']);
    }
    await ensureInitialized();
    try {
        ee.data.cancelOperation(taskName);
    } catch (error) {
        throw wrapError(error, `Failed to cancel ${taskName}`);
    }
}

module.exports = {
    ensureInitialized,
    evaluate,
    getInfo,
    getMapId,
    getDownloadUrl,
    submitExportToCloudStorage,
    pollExportTask,
    listOperations,
    cancelOperation,
    // Constants exposed so callers/tests can reason about defaults.
    EVALUATE_TIMEOUT_MS,
    POLL_INTERVAL_MS,
    POLL_MAX_ATTEMPTS,
};
