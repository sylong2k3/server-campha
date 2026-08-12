'use strict';

const db = require('../configs/database');

const lockFile = (client, fileObjectId) =>
    client.query(
        `SELECT id FROM core.file_objects
         WHERE id=$1 AND lifecycle_status='ready' AND deleted_at IS NULL
         FOR UPDATE`,
        [fileObjectId],
    );

const enqueue = async (client, { fileObjectId, requestedBy, sourceType, sourceId }) => {
    await lockFile(client, fileObjectId);
    const {
        rows: [job],
    } = await client.query(
        `INSERT INTO core.file_cleanup_jobs
            (file_object_id, requested_by, source_type, source_id)
         SELECT f.id, $2, $3, $4
         FROM core.file_objects f
         WHERE f.id = $1 AND f.lifecycle_status = 'ready' AND f.deleted_at IS NULL
         ON CONFLICT (file_object_id) WHERE status IN ('queued', 'running')
         DO UPDATE SET source_type = EXCLUDED.source_type, source_id = EXCLUDED.source_id
         RETURNING *`,
        [fileObjectId, requestedBy, sourceType, sourceId],
    );
    if (!job) {
        const error = new Error('File is not ready for deletion');
        error.code = 'FILE_NOT_READY_FOR_DELETE';
        throw error;
    }
    return job;
};

const enqueueMany = async (client, { fileObjectIds, requestedBy, sourceType, sourceId }) => {
    const ids = [...new Set(fileObjectIds.map(Number))];
    if (!ids.length) {
        return [];
    }
    await client.query(
        `SELECT id FROM core.file_objects
         WHERE id = ANY($1::bigint[]) AND lifecycle_status='ready' AND deleted_at IS NULL
         ORDER BY id FOR UPDATE`,
        [ids],
    );
    const { rows } = await client.query(
        `INSERT INTO core.file_cleanup_jobs
            (file_object_id, requested_by, source_type, source_id)
         SELECT f.id, $2, $3, $4
         FROM core.file_objects f
         WHERE f.id = ANY($1::bigint[]) AND f.lifecycle_status = 'ready' AND f.deleted_at IS NULL
         ON CONFLICT (file_object_id) WHERE status IN ('queued', 'running')
         DO UPDATE SET source_type = EXCLUDED.source_type, source_id = EXCLUDED.source_id
         RETURNING *`,
        [ids, requestedBy, sourceType, sourceId],
    );
    if (rows.length !== ids.length) {
        const error = new Error('One or more files are not ready for deletion');
        error.code = 'FILE_NOT_READY_FOR_DELETE';
        throw error;
    }
    return rows;
};

const activeReferences = async (fileObjectId, client = db) => {
    const {
        rows: [references],
    } = await client.query(
        `SELECT
            EXISTS (SELECT 1 FROM raster.satellite_images s WHERE s.file_object_id=$1 AND s.deleted_at IS NULL) satellite_image,
            EXISTS (SELECT 1 FROM gis.layers l WHERE l.source_file_id=$1 AND l.deleted_at IS NULL) layer,
            EXISTS (SELECT 1 FROM cms.documents d WHERE d.file_object_id=$1 AND d.deleted_at IS NULL) cms_document,
            EXISTS (SELECT 1 FROM cms.pdf_maps m WHERE m.file_object_id=$1 AND m.deleted_at IS NULL) cms_pdf_map,
            EXISTS (
                SELECT 1 FROM community.field_report_photos p
                JOIN community.field_reports r ON r.id=p.report_id
                WHERE p.file_object_id=$1 AND r.deleted_at IS NULL
            ) field_report,
            EXISTS (
                SELECT 1 FROM gis.layer_import_jobs j
                WHERE j.file_object_id=$1 AND j.status IN ('queued','running')
            ) layer_import`,
        [fileObjectId],
    );
    return Object.entries(references || {})
        .filter(([, active]) => active)
        .map(([type]) => type);
};

const lockedActiveReferences = async (fileObjectId, client) => {
    await lockFile(client, fileObjectId);
    return activeReferences(fileObjectId, client);
};

const claim = async (workerId, leaseSeconds = 120) => {
    const client = await db.getClient();
    try {
        await client.query('BEGIN');
        await client.query(
            `UPDATE core.file_cleanup_jobs SET status='queued',worker_id=NULL,lease_expires_at=NULL,
                next_attempt_at=NOW(),error_code='LEASE_EXPIRED'
             WHERE status='running' AND lease_expires_at<NOW() AND attempt<max_attempts`,
        );
        await client.query(
            `UPDATE core.file_cleanup_jobs SET status='failed',worker_id=NULL,lease_expires_at=NULL,
                finished_at=NOW(),error_code='LEASE_EXPIRED',
                error_message='Worker lease expired after maximum attempts'
             WHERE status='running' AND lease_expires_at<NOW() AND attempt>=max_attempts`,
        );
        await client.query(
            `UPDATE core.file_cleanup_jobs j
             SET status='blocked',finished_at=NOW(),error_code='LAYER_CLEANUP_INCOMPLETE',
                 error_message='Layer cleanup failed before source file deletion'
             FROM gis.layers l
             JOIN gis.layer_cleanup_jobs lc ON lc.layer_id=l.id
             WHERE j.status='queued' AND l.source_file_id=j.file_object_id
               AND l.deleted_at IS NOT NULL
               AND lc.status='failed' AND lc.attempt>=lc.max_attempts`,
        );
        const {
            rows: [candidate],
        } = await client.query(
            `SELECT j.id FROM core.file_cleanup_jobs j
             WHERE j.status='queued' AND j.next_attempt_at<=NOW() AND j.attempt<j.max_attempts
               AND NOT EXISTS (
                   SELECT 1 FROM gis.layers l
                   WHERE l.source_file_id=j.file_object_id
                     AND l.deleted_at IS NOT NULL
                     AND l.cleanup_status <> 'complete'
               )
             ORDER BY j.created_at,j.id FOR UPDATE OF j SKIP LOCKED LIMIT 1`,
        );
        if (!candidate) {
            await client.query('COMMIT');
            return null;
        }
        const {
            rows: [job],
        } = await client.query(
            `UPDATE core.file_cleanup_jobs SET status='running',worker_id=$2,attempt=attempt+1,
                started_at=COALESCE(started_at,NOW()),
                lease_expires_at=NOW()+make_interval(secs=>$3),error_code=NULL,error_message=NULL
             WHERE id=$1 RETURNING *`,
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

const heartbeat = async (id, workerId, leaseSeconds = 120) => {
    const { rowCount } = await db.query(
        `UPDATE core.file_cleanup_jobs SET lease_expires_at=NOW()+make_interval(secs=>$3)
         WHERE id=$1 AND status='running' AND worker_id=$2 AND lease_expires_at>NOW()`,
        [id, workerId, leaseSeconds],
    );
    return rowCount === 1;
};

const findFile = async (fileObjectId) => {
    const {
        rows: [file],
    } = await db.query(
        `SELECT id,category,object_key,lifecycle_status,deleted_at
         FROM core.file_objects WHERE id=$1`,
        [fileObjectId],
    );
    return file || null;
};

const block = async (job, workerId, references) => {
    const { rowCount } = await db.query(
        `UPDATE core.file_cleanup_jobs SET status='blocked',worker_id=NULL,lease_expires_at=NULL,
            finished_at=NOW(),error_code='FILE_STILL_IN_USE',error_message=$3
         WHERE id=$1 AND status='running' AND worker_id=$2 AND lease_expires_at>NOW()`,
        [job.id, workerId, references.join(',')],
    );
    return rowCount === 1;
};

const complete = async (job, workerId) => {
    const client = await db.getClient();
    try {
        await client.query('BEGIN');
        const owned = await client.query(
            `SELECT id FROM core.file_cleanup_jobs
             WHERE id=$1 AND status='running' AND worker_id=$2 AND lease_expires_at>NOW()
             FOR UPDATE`,
            [job.id, workerId],
        );
        if (owned.rowCount !== 1) {
            await client.query('ROLLBACK');
            return { completed: false, leaseLost: true, references: [] };
        }
        await client.query('SELECT id FROM core.file_objects WHERE id=$1 FOR UPDATE', [
            job.file_object_id,
        ]);
        const references = await activeReferences(job.file_object_id, client);
        if (references.length) {
            await client.query(
                `UPDATE core.file_cleanup_jobs
                 SET status='blocked',worker_id=NULL,lease_expires_at=NULL,finished_at=NOW(),
                     error_code='FILE_STILL_IN_USE',error_message=$3
                 WHERE id=$1 AND worker_id=$2`,
                [job.id, workerId, references.join(',')],
            );
            await client.query('COMMIT');
            return { completed: false, leaseLost: false, references };
        }
        await client.query(
            `UPDATE core.file_cleanup_jobs SET status='succeeded',worker_id=NULL,lease_expires_at=NULL,
                finished_at=NOW(),error_code=NULL,error_message=NULL
             WHERE id=$1 AND worker_id=$2`,
            [job.id, workerId],
        );
        await client.query(
            `UPDATE core.file_objects SET lifecycle_status='deleted',deleted_at=NOW()
             WHERE id=$1 AND lifecycle_status='ready' AND deleted_at IS NULL`,
            [job.file_object_id],
        );
        await client.query('COMMIT');
        return { completed: true, leaseLost: false, references: [] };
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
};

const fail = async (job, workerId, error) => {
    const retry = job.attempt < job.max_attempts;
    const { rowCount } = await db.query(
        `UPDATE core.file_cleanup_jobs SET status=$3,worker_id=NULL,lease_expires_at=NULL,
            next_attempt_at=CASE WHEN $4 THEN NOW()+make_interval(secs=>LEAST(3600,15*(2^attempt))) ELSE next_attempt_at END,
            finished_at=CASE WHEN $4 THEN NULL ELSE NOW() END,
            error_code=LEFT($5,80),error_message=LEFT($6,2000)
         WHERE id=$1 AND status='running' AND worker_id=$2 AND lease_expires_at>NOW()`,
        [
            job.id,
            workerId,
            retry ? 'queued' : 'failed',
            retry,
            error.code || 'FILE_DELETE_FAILED',
            error.message || 'File cleanup failed',
        ],
    );
    return rowCount === 1;
};

module.exports = {
    enqueue,
    enqueueMany,
    activeReferences,
    lockedActiveReferences,
    claim,
    heartbeat,
    findFile,
    block,
    complete,
    fail,
};
