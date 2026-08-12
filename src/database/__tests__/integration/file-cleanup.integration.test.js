'use strict';

if (process.env.DB_NAME !== 'campha_test') {
    throw new Error(
        `File cleanup integration chỉ được chạy với DB_NAME=campha_test; received ${process.env.DB_NAME}`,
    );
}

const db = require('../../../configs/database');
const repository = require('../../../repositories/file-cleanup.repository');

const PREFIX = `it_cleanup_${Date.now()}`;
let user;
let file;
let imageFile;

const cleanup = async () => {
    await db.query(
        `DELETE FROM core.file_cleanup_jobs
         WHERE file_object_id IN (
             SELECT id FROM core.file_objects
             WHERE original_name LIKE $1 OR original_name LIKE $2
         )`,
        [`${PREFIX}%`, `${PREFIX}_image%`],
    );
    await db.query(`DELETE FROM raster.satellite_images WHERE scene_code LIKE $1`, [`${PREFIX}%`]);
    await db.query(`DELETE FROM gis.layers WHERE code LIKE $1`, [`${PREFIX}%`]);
    await db.query(
        `DELETE FROM core.file_objects WHERE original_name LIKE $1 OR original_name LIKE $2`,
        [`${PREFIX}%`, `${PREFIX}_image%`],
    );
    await db.query(`DELETE FROM auth.users WHERE email LIKE $1`, [`${PREFIX}%`]);
};

describe('durable file cleanup integration', () => {
    beforeAll(async () => {
        await cleanup();
        const {
            rows: [createdUser],
        } = await db.query(
            `INSERT INTO auth.users (email,full_name,role_id,org_id,email_verified,is_active)
             SELECT $1,'Cleanup Integration',r.id,o.id,true,true
             FROM auth.roles r CROSS JOIN auth.organizations o
             WHERE r.code='so_tnmt' AND o.code='so_tnmt_qn'
             RETURNING id,org_id`,
            [`${PREFIX}@campha.test`],
        );
        user = createdUser;
        const {
            rows: [createdFile],
        } = await db.query(
            `INSERT INTO core.file_objects
                (category,bucket,object_key,owner_user_id,org_id,original_name,detected_mime,
                 size_bytes,sha256,scan_status,lifecycle_status,ready_at)
             VALUES ('raster','campha-raster',$1,$2,$3,$4,'image/tiff',4,repeat('b',64),'clean','ready',NOW())
             RETURNING *`,
            [`raster/${PREFIX}.tif`, user.id, user.org_id, `${PREFIX}.tif`],
        );
        file = createdFile;
        const {
            rows: [createdImageFile],
        } = await db.query(
            `INSERT INTO core.file_objects
                (category,bucket,object_key,owner_user_id,org_id,original_name,detected_mime,
                 size_bytes,sha256,scan_status,lifecycle_status,ready_at)
             VALUES ('raster','campha-raster',$1,$2,$3,$4,'image/tiff',4,repeat('c',64),'clean','ready',NOW())
             RETURNING *`,
            [`raster/${PREFIX}_image.tif`, user.id, user.org_id, `${PREFIX}_image.tif`],
        );
        imageFile = createdImageFile;
    });

    afterAll(async () => {
        await cleanup();
        db.stopPoolMonitor();
        await db.pool.end();
    });

    test('active reference blocks cleanup before enqueue', async () => {
        const {
            rows: [image],
        } = await db.query(
            `INSERT INTO raster.satellite_images
                (scene_code,title,platform,coverage_key,acquired_at,file_object_id,created_by)
             VALUES ($1,'Test','sentinel-2',$2,NOW(),$3,$4) RETURNING id`,
            [`${PREFIX}_active`, `${PREFIX}_coverage`, file.id, user.id],
        );
        await expect(repository.activeReferences(file.id)).resolves.toContain('satellite_image');
        await db.query(`UPDATE raster.satellite_images SET deleted_at=NOW() WHERE id=$1`, [
            image.id,
        ]);
    });

    test('deleteFiles=false soft-deletes entity and keeps object ready', async () => {
        const remoteSensingRepository = require('../../../repositories/remote-sensing.repository');
        const {
            rows: [keepFile],
        } = await db.query(
            `INSERT INTO core.file_objects
                (category,bucket,object_key,owner_user_id,org_id,original_name,detected_mime,
                 size_bytes,sha256,scan_status,lifecycle_status,ready_at)
             VALUES ('raster','campha-raster',$1,$2,$3,$4,'image/tiff',4,repeat('d',64),'clean','ready',NOW())
             RETURNING *`,
            [`raster/${PREFIX}_keep.tif`, user.id, user.org_id, `${PREFIX}_keep.tif`],
        );
        const {
            rows: [image],
        } = await db.query(
            `INSERT INTO raster.satellite_images
                (scene_code,title,platform,coverage_key,acquired_at,file_object_id,created_by)
             VALUES ($1,'Keep','sentinel-2',$2,NOW(),$3,$4) RETURNING id,updated_at`,
            [`${PREFIX}_keep`, `${PREFIX}_keep_coverage`, keepFile.id, user.id],
        );
        await expect(
            remoteSensingRepository.remove(image.id, image.updated_at, user.id, false),
        ).resolves.toMatchObject({ fileCleanupQueued: false, fileObjectIds: [] });
        const {
            rows: [state],
        } = await db.query(
            `SELECT f.lifecycle_status,f.deleted_at,
                    (SELECT COUNT(*)::int FROM core.file_cleanup_jobs j WHERE j.file_object_id=f.id) jobs
             FROM core.file_objects f WHERE f.id=$1`,
            [keepFile.id],
        );
        expect(state).toEqual({ lifecycle_status: 'ready', deleted_at: null, jobs: 0 });
    });

    test('active reference rolls back entity delete and enqueue', async () => {
        const remoteSensingRepository = require('../../../repositories/remote-sensing.repository');
        const {
            rows: [conflictFile],
        } = await db.query(
            `INSERT INTO core.file_objects
                (category,bucket,object_key,owner_user_id,org_id,original_name,detected_mime,
                 size_bytes,sha256,scan_status,lifecycle_status,ready_at)
             VALUES ('raster','campha-raster',$1,$2,$3,$4,'image/tiff',4,repeat('e',64),'clean','ready',NOW())
             RETURNING *`,
            [`raster/${PREFIX}_conflict.tif`, user.id, user.org_id, `${PREFIX}_conflict.tif`],
        );
        const {
            rows: [image],
        } = await db.query(
            `INSERT INTO raster.satellite_images
                (scene_code,title,platform,coverage_key,acquired_at,file_object_id,created_by)
             VALUES ($1,'Conflict','sentinel-2',$2,NOW(),$3,$4) RETURNING id,updated_at`,
            [`${PREFIX}_conflict`, `${PREFIX}_conflict_coverage`, conflictFile.id, user.id],
        );
        await db.query(
            `INSERT INTO gis.layers (code,name_vi,source_file_id,created_by)
             VALUES ($1,'Conflict',$2,$3)`,
            [`${PREFIX}_conflict_layer`, conflictFile.id, user.id],
        );
        await expect(
            remoteSensingRepository.remove(image.id, image.updated_at, user.id, true),
        ).resolves.toMatchObject({ conflict: 'FILE_STILL_IN_USE', references: ['layer'] });
        const {
            rows: [state],
        } = await db.query(
            `SELECT s.deleted_at,
                    (SELECT COUNT(*)::int FROM core.file_cleanup_jobs j WHERE j.file_object_id=s.file_object_id) jobs
             FROM raster.satellite_images s WHERE s.id=$1`,
            [image.id],
        );
        expect(state).toEqual({ deleted_at: null, jobs: 0 });
    });

    test('satellite delete soft-deletes and enqueues in one transaction', async () => {
        const remoteSensingRepository = require('../../../repositories/remote-sensing.repository');
        const {
            rows: [image],
        } = await db.query(
            `INSERT INTO raster.satellite_images
                (scene_code,title,platform,coverage_key,acquired_at,file_object_id,created_by)
             VALUES ($1,'Delete','sentinel-2',$2,NOW(),$3,$4) RETURNING id,updated_at`,
            [`${PREFIX}_delete`, `${PREFIX}_delete_coverage`, imageFile.id, user.id],
        );
        await expect(
            remoteSensingRepository.remove(image.id, image.updated_at, user.id, true),
        ).resolves.toMatchObject({
            id: image.id,
            fileCleanupQueued: true,
            fileObjectIds: [imageFile.id],
        });
        const {
            rows: [state],
        } = await db.query(
            `SELECT s.deleted_at IS NOT NULL AS image_deleted,j.status
             FROM raster.satellite_images s
             JOIN core.file_cleanup_jobs j ON j.file_object_id=s.file_object_id
             WHERE s.id=$1`,
            [image.id],
        );
        expect(state).toEqual({ image_deleted: true, status: 'queued' });
        await db.query(
            `UPDATE core.file_cleanup_jobs
             SET status='succeeded',finished_at=NOW()
             WHERE file_object_id=$1`,
            [imageFile.id],
        );
    });

    test('queued cleanup prevents a new reference and completion marks file deleted', async () => {
        const client = await db.getClient();
        let job;
        try {
            await client.query('BEGIN');
            job = await repository.enqueue(client, {
                fileObjectId: file.id,
                requestedBy: user.id,
                sourceType: 'storage_object',
                sourceId: file.id,
            });
            await client.query('COMMIT');
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
        expect(job.status).toBe('queued');
        await expect(
            db.query(
                `INSERT INTO gis.layers (code,name_vi,source_file_id,created_by)
                 VALUES ($1,'Blocked',$2,$3)`,
                [`${PREFIX}_blocked`, file.id, user.id],
            ),
        ).rejects.toMatchObject({ code: '23514', constraint: 'file_cleanup_reference_guard' });

        const claimed = await repository.claim('integration-worker', 60);
        expect(claimed.id).toBe(job.id);
        await expect(repository.complete(claimed, 'integration-worker')).resolves.toEqual({
            completed: true,
            leaseLost: false,
            references: [],
        });
        const {
            rows: [state],
        } = await db.query(
            `SELECT lifecycle_status,deleted_at IS NOT NULL AS deleted
             FROM core.file_objects WHERE id=$1`,
            [file.id],
        );
        expect(state).toEqual({ lifecycle_status: 'deleted', deleted: true });
    });
});
