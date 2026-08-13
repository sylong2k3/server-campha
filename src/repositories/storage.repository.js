'use strict';

const db = require('../configs/database');
const fileCleanupRepository = require('./file-cleanup.repository');

const createQuarantine = async ({
    category,
    bucket,
    objectKey,
    quarantineKey,
    ownerUserId,
    orgId,
    originalName,
    expectedMime,
    expiresAt,
}) => {
    const {
        rows: [row],
    } = await db.query(
        `INSERT INTO core.file_objects
             (category, bucket, object_key, quarantine_key, owner_user_id, org_id,
              original_name, expected_mime, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING *`,
        [
            category,
            bucket,
            objectKey,
            quarantineKey,
            ownerUserId,
            orgId,
            originalName,
            expectedMime,
            expiresAt,
        ],
    );
    return row;
};

const findAccessibleById = async (id, actorId) => {
    const {
        rows: [row],
    } = await db.query(
        `SELECT * FROM core.file_objects
         WHERE id = $1 AND owner_user_id = $2 AND deleted_at IS NULL`,
        [id, actorId],
    );
    return row || null;
};

const findById = async (id) => {
    const {
        rows: [row],
    } = await db.query(
        `SELECT * FROM core.file_objects
         WHERE id = $1 AND deleted_at IS NULL`,
        [id],
    );
    return row || null;
};

const claimForScan = async (id, actorId) => {
    const {
        rows: [row],
    } = await db.query(
        `UPDATE core.file_objects
         SET scan_status = 'scanning'
         WHERE id = $1 AND owner_user_id = $2
           AND lifecycle_status = 'quarantine' AND scan_status = 'pending'
           AND expires_at > NOW()
         RETURNING *`,
        [id, actorId],
    );
    return row || null;
};

const markReady = async (id, { sizeBytes, sha256, detectedMime }) => {
    const {
        rows: [row],
    } = await db.query(
        `UPDATE core.file_objects
         SET lifecycle_status = 'ready', scan_status = 'clean', ready_at = NOW(),
             size_bytes = $2, sha256 = $3, detected_mime = $4,
             quarantine_key = NULL, expires_at = NULL
         WHERE id = $1 AND lifecycle_status = 'quarantine' AND scan_status = 'scanning'
         RETURNING *`,
        [id, sizeBytes, sha256, detectedMime],
    );
    return row || null;
};

const markRejected = async (id, scanStatus) => {
    const status = ['infected', 'error'].includes(scanStatus) ? scanStatus : 'error';
    const {
        rows: [row],
    } = await db.query(
        `UPDATE core.file_objects
         SET lifecycle_status = 'rejected', scan_status = $2, expires_at = NOW()
         WHERE id = $1 AND lifecycle_status = 'quarantine'
         RETURNING *`,
        [id, status],
    );
    return row || null;
};

const resetPending = async (id) => {
    await db.query(
        `UPDATE core.file_objects SET scan_status = 'pending'
         WHERE id = $1 AND lifecycle_status = 'quarantine' AND scan_status = 'scanning'`,
        [id],
    );
};

const enqueueDelete = async (id, actorId) => {
    const client = await db.getClient();
    try {
        await client.query('BEGIN');
        const {
            rows: [file],
        } = await client.query(
            `SELECT id FROM core.file_objects
             WHERE id=$1 AND owner_user_id=$2 AND lifecycle_status='ready' AND deleted_at IS NULL
             FOR UPDATE`,
            [id, actorId],
        );
        if (!file) {
            await client.query('ROLLBACK');
            return null;
        }
        const references = await fileCleanupRepository.lockedActiveReferences(id, client);
        if (references.length) {
            await client.query('ROLLBACK');
            return { conflict: 'FILE_STILL_IN_USE', references };
        }
        const job = await fileCleanupRepository.enqueue(client, {
            fileObjectId: id,
            requestedBy: actorId,
            sourceType: 'storage_object',
            sourceId: id,
        });
        await client.query('COMMIT');
        return { id, fileCleanupQueued: Boolean(job), fileObjectIds: [id] };
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
};

module.exports = {
    createQuarantine,
    findAccessibleById,
    findById,
    claimForScan,
    markReady,
    markRejected,
    resetPending,
    enqueueDelete,
};
