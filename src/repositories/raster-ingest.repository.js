'use strict';

/**
 * Data-access layer for `gis.raster_ingest_jobs` and `gis.raster_ingest_dlq`.
 *
 * Consumed by:
 *   - services/raster-ingest.enqueue.js   (findActiveBy*, insertJob)
 *   - services/raster-ingest.pipeline.js  (updateStatus, saveOutput)
 *   - services/raster-ingest.retry.js     (updateStatus, incrementRetry, moveToDlq)
 *   - services/raster-ingest.service.js   (findById, listByLayerCode)
 *   - workers/rasterIngest.worker.js      (claimPending)
 *   - workers/geeInterruptedRunRecovery.worker.js (recoverInterruptedJobs)
 *
 * @schema migrations/081_raster_ingest.sql
 */

const db = require('../configs/database');

const ACTIVE_STATES = Object.freeze([
    'pending',
    'downloading',
    'validating',
    'uploading',
    'publishing',
]);

// ── Lookups ──────────────────────────────────────────────────────────────────

const findById = async (id, client = db) => {
    const { rows } = await client.query(
        'SELECT * FROM gis.raster_ingest_jobs WHERE id = $1',
        [id],
    );
    return rows[0] || null;
};

const findActiveBySourceHash = async (sourceHash, client = db) => {
    const { rows } = await client.query(
        `SELECT *
           FROM gis.raster_ingest_jobs
          WHERE source_hash = $1
            AND status = ANY($2::text[])
          ORDER BY id DESC
          LIMIT 1`,
        [sourceHash, ACTIVE_STATES],
    );
    return rows[0] || null;
};

const findActiveByLayerCode = async (layerCode, client = db) => {
    const { rows } = await client.query(
        `SELECT *
           FROM gis.raster_ingest_jobs
          WHERE layer_code = $1
            AND status = ANY($2::text[])
          ORDER BY id DESC
          LIMIT 1`,
        [layerCode, ACTIVE_STATES],
    );
    return rows[0] || null;
};

const listByLayerCode = async (layerCode, { limit = 20, offset = 0 } = {}) => {
    const { rows } = await db.query(
        `SELECT *, COUNT(*) OVER()::int AS total_count
           FROM gis.raster_ingest_jobs
          WHERE layer_code = $1
          ORDER BY id DESC
          LIMIT $2 OFFSET $3`,
        [layerCode, limit, offset],
    );
    const total = rows[0]?.total_count || 0;
    return { items: rows.map(({ total_count: _t, ...row }) => row), total };
};

// ── Writes ───────────────────────────────────────────────────────────────────

const insertJob = async (client, payload) => {
    const { rows } = await client.query(
        `INSERT INTO gis.raster_ingest_jobs (
            layer_code, source_kind, source_url, source_hash,
            request_params, created_by
        ) VALUES ($1, $2, $3, $4, $5::jsonb, $6)
        RETURNING *`,
        [
            payload.layerCode,
            payload.sourceKind || 'gee_download_url',
            payload.sourceUrl,
            payload.sourceHash,
            JSON.stringify(payload.requestParams || {}),
            payload.createdBy || null,
        ],
    );
    return rows[0];
};

const updateStatus = async (id, { status, progress, errorLog } = {}, client = db) => {
    const patches = [];
    const params = [id];
    if (status !== undefined) {
        params.push(status);
        patches.push(`status = $${params.length}`);
    }
    if (progress !== undefined) {
        params.push(progress);
        patches.push(`progress = $${params.length}`);
    }
    if (errorLog !== undefined) {
        params.push(errorLog);
        patches.push(`error_log = $${params.length}`);
    }
    if (status === 'completed') {
        patches.push('completed_at = NOW()');
    }
    if (patches.length === 0) {
        return null;
    }
    const { rows } = await client.query(
        `UPDATE gis.raster_ingest_jobs SET ${patches.join(', ')} WHERE id = $1 RETURNING *`,
        params,
    );
    return rows[0] || null;
};

const incrementRetry = async (id, { nextRetryAtMs, errorLog } = {}, client = db) => {
    const params = [id];
    const setClauses = ['retry_count = retry_count + 1', "status = 'pending'"];
    if (Number.isFinite(nextRetryAtMs) && nextRetryAtMs > 0) {
        params.push(nextRetryAtMs);
        setClauses.push(`next_attempt_at = NOW() + ($${params.length} || ' milliseconds')::interval`);
    } else {
        setClauses.push('next_attempt_at = NOW()');
    }
    if (errorLog !== undefined) {
        params.push(errorLog);
        setClauses.push(`error_log = $${params.length}`);
    }
    const { rows } = await client.query(
        `UPDATE gis.raster_ingest_jobs SET ${setClauses.join(', ')}
          WHERE id = $1 RETURNING *`,
        params,
    );
    return rows[0] || null;
};

const moveToDlq = async (id, { errorLog, reason, detail } = {}, injected = {}) => {
    // Two-writes transaction: mark the job dlq + insert the DLQ record so
    // admin can inspect + retry from the UI. Callers may inject a db client
    // (e.g. the pool or a test double).
    const pool = injected.db?.pool || db.pool;
    const client = injected.client || (await pool.connect());
    const released = () => {
        if (!injected.client && typeof client.release === 'function') {
            client.release();
        }
    };
    try {
        await client.query('BEGIN');
        const { rows: jobRows } = await client.query(
            `UPDATE gis.raster_ingest_jobs
                SET status = 'dlq',
                    error_log = COALESCE($2, error_log),
                    updated_at = NOW()
              WHERE id = $1
              RETURNING *`,
            [id, errorLog || null],
        );
        if (!jobRows[0]) {
            await client.query('ROLLBACK');
            released();
            return null;
        }
        await client.query(
            `INSERT INTO gis.raster_ingest_dlq (job_id, reason, error_log, detail)
             VALUES ($1, $2, $3, $4::jsonb)`,
            [id, reason || 'NON_RETRYABLE', errorLog || null, JSON.stringify(detail || {})],
        );
        await client.query('COMMIT');
        return jobRows[0];
    } catch (err) {
        try {
            await client.query('ROLLBACK');
        } catch {
            /* nested rollback failures aren't fatal */
        }
        throw err;
    } finally {
        released();
    }
};

const saveOutput = async (id, patch, client = db) => {
    const { rows } = await client.query(
        `UPDATE gis.raster_ingest_jobs
            SET minio_category   = COALESCE($2, minio_category),
                minio_key        = COALESCE($3, minio_key),
                file_size_bytes  = COALESCE($4, file_size_bytes),
                file_sha256      = COALESCE($5, file_sha256),
                geoserver_store  = COALESCE($6, geoserver_store),
                geoserver_layer  = COALESCE($7, geoserver_layer),
                layer_id         = COALESCE($8, layer_id)
          WHERE id = $1
          RETURNING *`,
        [
            id,
            patch.minioCategory || null,
            patch.minioKey || null,
            patch.fileSizeBytes || null,
            patch.fileSha256 || null,
            patch.geoserverStore || null,
            patch.geoserverLayer || null,
            patch.layerId || null,
        ],
    );
    return rows[0] || null;
};

// ── Worker claim + recovery ──────────────────────────────────────────────────

/**
 * SELECT ... FOR UPDATE SKIP LOCKED — race-safe with N worker instances.
 * Only claims jobs whose retry budget still allows another attempt.
 */
const claimPending = async ({ batchSize = 1, maxRetries = 3 } = {}) => {
    const pool = db.pool;
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const { rows: claimed } = await client.query(
            `SELECT *
               FROM gis.raster_ingest_jobs
              WHERE status = 'pending'
                AND (next_attempt_at IS NULL OR next_attempt_at <= NOW())
                AND retry_count < $2
              ORDER BY id
              LIMIT $1
              FOR UPDATE SKIP LOCKED`,
            [batchSize, maxRetries],
        );
        if (!claimed.length) {
            await client.query('COMMIT');
            return [];
        }
        const ids = claimed.map((row) => row.id);
        await client.query(
            `UPDATE gis.raster_ingest_jobs
                SET status = 'downloading', progress = 5
              WHERE id = ANY($1::bigint[])`,
            [ids],
        );
        await client.query('COMMIT');
        return claimed;
    } catch (err) {
        try {
            await client.query('ROLLBACK');
        } catch {
            /* nested rollback failures aren't fatal */
        }
        throw err;
    } finally {
        client.release();
    }
};

/**
 * Startup recovery — reset live-state jobs to `pending` so the worker picks
 * them up, unless they've exhausted retries in which case they move to DLQ.
 * Called ONCE from workers/geeInterruptedRunRecovery.worker.js.
 * Returns the count of jobs affected.
 */
const recoverInterruptedJobs = async ({
    errorCode = 'INTERRUPTED_ON_RESTART',
    maxRetries,
} = {}) => {
    // Prefer the config module's MAX_RETRIES so this stays consistent across
    // the codebase, but allow the caller to override for tests.
    const cfg = require('../configs/raster-ingest');
    const budget = Number.isFinite(maxRetries) ? maxRetries : cfg.MAX_RETRIES;

    const pool = db.pool;
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        // Jobs that had used their retry budget → DLQ.
        const { rows: dlqRows } = await client.query(
            `UPDATE gis.raster_ingest_jobs
                SET status = 'dlq', updated_at = NOW(),
                    error_log = COALESCE(error_log, '') || $2
              WHERE status IN ('downloading','validating','uploading','publishing')
                AND retry_count >= $1
              RETURNING id`,
            [budget, `\n[${errorCode}] moved to dlq at ${new Date().toISOString()}`],
        );
        for (const row of dlqRows) {
            await client.query(
                `INSERT INTO gis.raster_ingest_dlq (job_id, reason, error_log)
                 VALUES ($1, 'INTERRUPTED_ON_RESTART', $2)`,
                [row.id, 'Interrupted mid-pipeline on server restart'],
            );
        }
        // Jobs still within retry budget → back to pending so the worker
        // picks them up on the next tick.
        const { rows: rewoundRows } = await client.query(
            `UPDATE gis.raster_ingest_jobs
                SET status = 'pending', progress = 0, updated_at = NOW(),
                    next_attempt_at = NOW(),
                    error_log = COALESCE(error_log, '') || $1
              WHERE status IN ('downloading','validating','uploading','publishing')
              RETURNING id`,
            [`\n[${errorCode}] rewound to pending at ${new Date().toISOString()}`],
        );
        await client.query('COMMIT');
        return dlqRows.length + rewoundRows.length;
    } catch (err) {
        try {
            await client.query('ROLLBACK');
        } catch {
            /* nested rollback failures aren't fatal */
        }
        throw err;
    } finally {
        client.release();
    }
};

module.exports = {
    ACTIVE_STATES,
    findById,
    findActiveBySourceHash,
    findActiveByLayerCode,
    listByLayerCode,
    insertJob,
    updateStatus,
    incrementRetry,
    moveToDlq,
    saveOutput,
    claimPending,
    recoverInterruptedJobs,
};
