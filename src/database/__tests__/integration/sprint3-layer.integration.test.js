if (process.env.DB_NAME !== 'campha_test') {
    throw new Error(`Sprint 3 write integration chỉ được chạy với DB_NAME=campha_test; received ${process.env.DB_NAME}`);
}

const db = require('../../../configs/database');
const layerRepository = require('../../../repositories/layer.repository');
const jobRepository = require('../../../repositories/layer-job.repository');

const PREFIX = 'it_s3_';
let actorUser;
let fileObject;
let layer;

const cleanup = async () => {
    await db.query(`DELETE FROM gis.layer_import_jobs WHERE input_payload->>'code' LIKE $1`, [`${PREFIX}%`]);
    await db.query(`DELETE FROM gis.layer_cleanup_jobs WHERE layer_id IN (SELECT id FROM gis.layers WHERE code LIKE $1)`, [`${PREFIX}%`]);
    await db.query(`DELETE FROM gis.layers WHERE code LIKE $1`, [`${PREFIX}%`]);
    await db.query(`DELETE FROM core.file_objects WHERE original_name LIKE $1`, [`${PREFIX}%`]);
    await db.query(`DELETE FROM auth.users WHERE email LIKE $1`, [`${PREFIX}%`]);
};

describe('Sprint 3 layer write integration', () => {
    beforeAll(async () => {
        await cleanup();
        const suffix = Date.now();
        const { rows: [user] } = await db.query(`
            INSERT INTO auth.users (email, full_name, role_id, org_id, email_verified, is_active)
            SELECT $1, 'Sprint 3 Integration', r.id, o.id, true, true
            FROM auth.roles r CROSS JOIN auth.organizations o
            WHERE r.code = 'so_tnmt' AND o.code = 'so_tnmt_qn'
            RETURNING id, org_id
        `, [`${PREFIX}${suffix}@campha.test`]);
        if (!user) { throw new Error('so_tnmt role or organization fixture missing'); }
        actorUser = user;
        const { rows: [file] } = await db.query(`
            INSERT INTO core.file_objects
                (category, bucket, object_key, owner_user_id, org_id, original_name,
                 detected_mime, size_bytes, sha256, scan_status, lifecycle_status, ready_at)
            VALUES ('layers', 'campha-layers', $1, $2, $3, $4,
                    'application/zip', 100, repeat('a', 64), 'clean', 'ready', NOW())
            RETURNING *
        `, [`integration/${PREFIX}${suffix}.zip`, user.id, user.org_id, `${PREFIX}${suffix}.zip`]);
        fileObject = file;
        const { rows: [created] } = await db.query(`
            INSERT INTO gis.layers (code, name_vi, geometry_type, srid, storage_kind, table_name, created_by)
            VALUES ($1, 'Integration layer', 'POINT', 4326, 'postgis', $2, $3) RETURNING *
        `, [`${PREFIX}${suffix}`, `${PREFIX}table_${suffix}`, user.id]);
        layer = created;
    });

    afterAll(async () => {
        await cleanup();
        db.stopPoolMonitor();
        await db.pool.end();
    });

    test('migration 007 durable tables and constraints exist', async () => {
        const { rows: [row] } = await db.query(`SELECT
            to_regclass('gis.layer_import_jobs') IS NOT NULL AS imports,
            to_regclass('gis.layer_import_errors') IS NOT NULL AS errors,
            to_regclass('gis.layer_cleanup_jobs') IS NOT NULL AS cleanup
        `);
        expect(row).toEqual({ imports: true, errors: true, cleanup: true });
        await expect(db.query(`INSERT INTO gis.layers (code, name_vi) VALUES ('BAD-CODE', 'x')`))
            .rejects.toMatchObject({ code: '23514' });
    });

    test('two claims cannot acquire the same import job', async () => {
        const inputPayload = { fileObjectId: fileObject.id, code: layer.code, nameVi: 'Test', category: 'test', targetSrid: 4326 };
        const job = await jobRepository.createImport({
            importType: 'shapefile', fileObjectId: fileObject.id,
            ownerUserId: actorUser.id, orgId: actorUser.org_id, inputPayload,
        });
        expect(job.status).toBe('queued');
        const claimed = await Promise.all([
            jobRepository.claimImport('worker-a', 60),
            jobRepository.claimImport('worker-b', 60),
        ]);
        expect(claimed.filter(Boolean)).toHaveLength(1);
        expect(claimed.filter(Boolean)[0].id).toBe(job.id);
        await jobRepository.failImport(job.id, claimed.filter(Boolean)[0].worker_id, 'TEST_DONE', 'fixture cleanup');
    });

    test('stale import worker cannot complete or fail after lease loss', async () => {
        const inputPayload = { fileObjectId: fileObject.id, code: `${PREFIX}stale_import`, nameVi: 'Test', category: 'test', targetSrid: 4326 };
        const job = await jobRepository.createImport({
            importType: 'shapefile', fileObjectId: fileObject.id,
            ownerUserId: actorUser.id, orgId: actorUser.org_id, inputPayload,
        });
        const claimed = await jobRepository.claimImport('worker-stale-import', 60);
        expect(claimed.id).toBe(job.id);
        await db.query(`UPDATE gis.layer_import_jobs SET lease_expires_at = NOW() - INTERVAL '1 second' WHERE id = $1`, [job.id]);
        await expect(jobRepository.completeImport(job.id, 'worker-stale-import', {
            layerId: layer.id, featureCount: 1, geometryType: 'POINT', sourceSrid: 4326, targetSrid: 4326,
        })).resolves.toBeNull();
        await expect(jobRepository.failImport(job.id, 'worker-stale-import', 'STALE', 'stale')).resolves.toBeNull();
        const { rows: [state] } = await db.query(`SELECT status, layer_id FROM gis.layer_import_jobs WHERE id = $1`, [job.id]);
        expect(state).toEqual({ status: 'running', layer_id: null });
    });

    test('stale cleanup worker cannot update job or layer status', async () => {
        const { rows: [job] } = await db.query(`
            INSERT INTO gis.layer_cleanup_jobs (layer_id, status, attempt, worker_id, lease_expires_at)
            VALUES ($1, 'running', 1, 'worker-stale-cleanup', NOW() - INTERVAL '1 second') RETURNING *`,
        [layer.id]);
        const { rows: [layerState] } = await db.query(
            `UPDATE gis.layers SET cleanup_status = 'running' WHERE id = $1 RETURNING updated_at`,
            [layer.id]
        );
        layer.updated_at = layerState.updated_at;
        await expect(jobRepository.completeCleanup(job.id, 'worker-stale-cleanup', layer.id)).resolves.toBe(false);
        await expect(jobRepository.failCleanup(job, 'worker-stale-cleanup', 'stale')).resolves.toBe(false);
        const { rows: [state] } = await db.query(`SELECT cleanup_status FROM gis.layers WHERE id = $1`, [layer.id]);
        expect(state.cleanup_status).toBe('running');
    });

    test('optimistic metadata update rejects stale timestamp', async () => {
        const updated = await layerRepository.updateMetadata(layer.id, {
            expectedUpdatedAt: layer.updated_at,
            nameVi: 'Integration updated',
        });
        expect(updated.name_vi).toBe('Integration updated');
        const stale = await layerRepository.updateMetadata(layer.id, {
            expectedUpdatedAt: layer.updated_at,
            nameVi: 'Stale overwrite',
        });
        expect(stale).toBeNull();
        layer = updated;
    });

    test('ACL replacement is atomic and delete enqueues cleanup', async () => {
        const replaced = await layerRepository.replacePermissions(layer.id, [{
            roleCode: 'citizen', canView: true, canExport: false, canEdit: false, canDelete: false,
        }]);
        expect(replaced.permissions).toEqual([expect.objectContaining({ roleCode: 'citizen', canView: true })]);
        const deleted = await layerRepository.softDeleteAndEnqueue(layer.id, replaced.updated_at);
        expect(deleted.cleanup_status).toBe('queued');
        const { rows: [count] } = await db.query(`SELECT COUNT(*)::int AS value FROM gis.layer_cleanup_jobs WHERE layer_id = $1`, [layer.id]);
        expect(count.value).toBe(1);
    });
});
