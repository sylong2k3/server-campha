'use strict';

const db = require('../configs/database');

const createImport = async ({ importType, fileObjectId, ownerUserId, orgId, inputPayload }) => {
    const {
        rows: [row],
    } = await db.query(
        `INSERT INTO gis.layer_import_jobs
            (import_type, file_object_id, owner_user_id, org_id, input_payload)
         SELECT $1, f.id, $3, $4, $5::jsonb
         FROM core.file_objects f
         WHERE f.id = $2 AND f.owner_user_id = $3 AND f.category = 'layers'
           AND f.lifecycle_status = 'ready' AND f.scan_status = 'clean' AND f.deleted_at IS NULL
         RETURNING *`,
        [importType, fileObjectId, ownerUserId, orgId, JSON.stringify(inputPayload)],
    );
    return row || null;
};

const findImportById = async (id, actor) => {
    const canManage = actor.role === 'so_tnmt';
    const {
        rows: [row],
    } = await db.query(
        `SELECT j.id, j.import_type, j.file_object_id, j.status, j.progress, j.attempt,
                j.max_attempts, j.layer_id, j.feature_count, j.geometry_type,
                j.source_srid, j.target_srid, j.error_code, j.error_message,
                j.started_at, j.finished_at, j.created_at, j.updated_at,
                l.publish_status, l.geoserver_layer
         FROM gis.layer_import_jobs j
         LEFT JOIN gis.layers l ON l.id = j.layer_id
         WHERE j.id = $1 AND ($2::boolean OR j.owner_user_id = $3)`,
        [id, canManage, actor.id],
    );
    return row || null;
};

const listImportErrors = async (jobId, actor, page, limit) => {
    const canManage = actor.role === 'so_tnmt';
    const offset = (page - 1) * limit;
    const { rows } = await db.query(
        `SELECT e.*, COUNT(*) OVER()::int AS total_count
         FROM gis.layer_import_errors e
         JOIN gis.layer_import_jobs j ON j.id = e.job_id
         WHERE e.job_id = $1 AND ($2::boolean OR j.owner_user_id = $3)
         ORDER BY e.source_row NULLS FIRST, e.id
         LIMIT $4 OFFSET $5`,
        [jobId, canManage, actor.id, limit, offset],
    );
    const total = rows[0]?.total_count || 0;
    return { items: rows.map(({ total_count: _totalCount, ...row }) => row), total };
};

const claimImport = async (workerId, leaseSeconds = 120) => {
    const client = await db.getClient();
    try {
        await client.query('BEGIN');
        await client.query(
            `UPDATE gis.layer_import_jobs
             SET status = 'failed', finished_at = NOW(), error_code = 'WORKER_LEASE_EXHAUSTED',
                 error_message = 'Worker lease expired after maximum attempts', worker_id = NULL, lease_expires_at = NULL
             WHERE status = 'running' AND lease_expires_at < NOW() AND attempt >= max_attempts`,
        );
        await client.query(
            `UPDATE gis.layer_import_jobs
             SET status = 'queued', worker_id = NULL, lease_expires_at = NULL,
                 error_code = 'WORKER_LEASE_EXPIRED', error_message = 'Worker lease expired; job requeued'
             WHERE status = 'running' AND lease_expires_at < NOW() AND attempt < max_attempts`,
        );
        const {
            rows: [candidate],
        } = await client.query(
            `SELECT id FROM gis.layer_import_jobs
             WHERE status = 'queued' AND attempt < max_attempts
             ORDER BY created_at, id FOR UPDATE SKIP LOCKED LIMIT 1`,
        );
        if (!candidate) {
            await client.query('COMMIT');
            return null;
        }
        const {
            rows: [job],
        } = await client.query(
            `UPDATE gis.layer_import_jobs
             SET status = 'running', worker_id = $2, attempt = attempt + 1,
                 started_at = COALESCE(started_at, NOW()),
                 lease_expires_at = NOW() + make_interval(secs => $3), progress = GREATEST(progress, 1),
                 error_code = NULL, error_message = NULL
             WHERE id = $1 RETURNING *`,
            [candidate.id, workerId, leaseSeconds],
        );
        await client.query('COMMIT');
        return job;
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
};

const heartbeatImport = async (id, workerId, progress, leaseSeconds = 120) => {
    const { rowCount } = await db.query(
        `UPDATE gis.layer_import_jobs
         SET progress = GREATEST(progress, $3), lease_expires_at = NOW() + make_interval(secs => $4)
         WHERE id = $1 AND status = 'running' AND worker_id = $2`,
        [id, workerId, progress, leaseSeconds],
    );
    return rowCount === 1;
};

const addImportErrors = async (jobId, workerId, errors) => {
    if (!errors.length) {
        return false;
    }
    const client = await db.getClient();
    try {
        await client.query('BEGIN');
        const owned = await client.query(
            `SELECT id FROM gis.layer_import_jobs
             WHERE id = $1 AND status = 'running' AND worker_id = $2
               AND lease_expires_at > NOW() FOR UPDATE`,
            [jobId, workerId],
        );
        if (owned.rowCount !== 1) {
            await client.query('ROLLBACK');
            return false;
        }
        await client.query('DELETE FROM gis.layer_import_errors WHERE job_id = $1', [jobId]);
        for (const error of errors) {
            await client.query(
                `INSERT INTO gis.layer_import_errors
                    (job_id, source_row, field_name, error_code, message, details)
                 VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
                [
                    jobId,
                    error.sourceRow || null,
                    error.fieldName || null,
                    error.code,
                    error.message,
                    JSON.stringify(error.details || {}),
                ],
            );
        }
        await client.query('COMMIT');
        return true;
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
};

const completeImport = async (id, workerId, result) => {
    const {
        rows: [row],
    } = await db.query(
        `UPDATE gis.layer_import_jobs
         SET status = 'succeeded', progress = 100, layer_id = $3, feature_count = $4,
             geometry_type = $5, source_srid = $6, target_srid = $7,
             finished_at = NOW(), worker_id = NULL, lease_expires_at = NULL
         WHERE id = $1 AND status = 'running' AND worker_id = $2
           AND lease_expires_at > NOW() RETURNING *`,
        [
            id,
            workerId,
            result.layerId,
            result.featureCount,
            result.geometryType,
            result.sourceSrid,
            result.targetSrid,
        ],
    );
    return row || null;
};

const failImport = async (id, workerId, errorCode, errorMessage) => {
    const {
        rows: [row],
    } = await db.query(
        `UPDATE gis.layer_import_jobs
         SET status = 'failed', finished_at = NOW(), worker_id = NULL, lease_expires_at = NULL,
             error_code = $3, error_message = LEFT($4, 2000)
         WHERE id = $1 AND status = 'running' AND worker_id = $2
           AND lease_expires_at > NOW() RETURNING *`,
        [id, workerId, errorCode, errorMessage],
    );
    return row || null;
};

const claimCleanup = async (workerId, leaseSeconds = 120) => {
    const client = await db.getClient();
    try {
        await client.query('BEGIN');
        await client.query(
            `UPDATE gis.layer_cleanup_jobs
             SET status = 'queued', worker_id = NULL, lease_expires_at = NULL,
                 next_attempt_at = NOW()
             WHERE status = 'running' AND lease_expires_at < NOW() AND attempt < max_attempts`,
        );
        await client.query(
            `UPDATE gis.layer_cleanup_jobs c
             SET status = 'failed', worker_id = NULL, lease_expires_at = NULL, finished_at = NOW(),
                 error_message = 'Worker lease expired after maximum attempts'
             WHERE c.status = 'running' AND c.lease_expires_at < NOW() AND c.attempt >= c.max_attempts`,
        );
        const {
            rows: [candidate],
        } = await client.query(
            `SELECT id FROM gis.layer_cleanup_jobs
             WHERE status = 'queued' AND next_attempt_at <= NOW() AND attempt < max_attempts
             ORDER BY created_at, id FOR UPDATE SKIP LOCKED LIMIT 1`,
        );
        if (!candidate) {
            await client.query('COMMIT');
            return null;
        }
        const {
            rows: [job],
        } = await client.query(
            `UPDATE gis.layer_cleanup_jobs
             SET status = 'running', worker_id = $2, attempt = attempt + 1,
                 started_at = COALESCE(started_at, NOW()),
                 lease_expires_at = NOW() + make_interval(secs => $3)
             WHERE id = $1 RETURNING *`,
            [candidate.id, workerId, leaseSeconds],
        );
        await client.query("UPDATE gis.layers SET cleanup_status = 'running' WHERE id = $1", [
            job.layer_id,
        ]);
        await client.query('COMMIT');
        return job;
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
};

const heartbeatCleanup = async (id, workerId, leaseSeconds = 120) => {
    const { rowCount } = await db.query(
        `UPDATE gis.layer_cleanup_jobs
         SET lease_expires_at = NOW() + make_interval(secs => $3)
         WHERE id = $1 AND status = 'running' AND worker_id = $2
           AND lease_expires_at > NOW()`,
        [id, workerId, leaseSeconds],
    );
    return rowCount === 1;
};

const completeCleanup = async (id, workerId, layerId) => {
    const client = await db.getClient();
    try {
        await client.query('BEGIN');
        const completed = await client.query(
            `UPDATE gis.layer_cleanup_jobs
             SET status = 'succeeded', finished_at = NOW(), worker_id = NULL, lease_expires_at = NULL
             WHERE id = $1 AND status = 'running' AND worker_id = $2
               AND lease_expires_at > NOW()`,
            [id, workerId],
        );
        if (completed.rowCount !== 1) {
            await client.query('ROLLBACK');
            return false;
        }
        await client.query("UPDATE gis.layers SET cleanup_status = 'complete' WHERE id = $1", [
            layerId,
        ]);
        await client.query('UPDATE raster.satellite_images SET layer_id=NULL WHERE layer_id=$1', [
            layerId,
        ]);
        await client.query('COMMIT');
        return true;
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
};

const failCleanup = async (job, workerId, message) => {
    const retry = job.attempt < job.max_attempts;
    const client = await db.getClient();
    try {
        await client.query('BEGIN');
        const failed = await client.query(
            `UPDATE gis.layer_cleanup_jobs
             SET status = $3, worker_id = NULL, lease_expires_at = NULL,
                 next_attempt_at = CASE WHEN $4 THEN NOW() + make_interval(secs => LEAST(3600, 15 * (2 ^ attempt))) ELSE next_attempt_at END,
                 finished_at = CASE WHEN $4 THEN NULL ELSE NOW() END,
                 error_message = LEFT($5, 2000)
             WHERE id = $1 AND status = 'running' AND worker_id = $2
               AND lease_expires_at > NOW()`,
            [job.id, workerId, retry ? 'queued' : 'failed', retry, message],
        );
        if (failed.rowCount !== 1) {
            await client.query('ROLLBACK');
            return false;
        }
        await client.query('UPDATE gis.layers SET cleanup_status = $2 WHERE id = $1', [
            job.layer_id,
            retry ? 'queued' : 'failed',
        ]);
        await client.query('COMMIT');
        return true;
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
};

module.exports = {
    createImport,
    findImportById,
    listImportErrors,
    claimImport,
    heartbeatImport,
    addImportErrors,
    completeImport,
    failImport,
    claimCleanup,
    heartbeatCleanup,
    completeCleanup,
    failCleanup,
};
