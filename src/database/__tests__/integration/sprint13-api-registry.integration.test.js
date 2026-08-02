'use strict';
process.env.API_SHARE_JWT_SECRET = 'i'.repeat(48);
const db = require('../../../configs/database'),
    token = require('../../../utils/api-share-token.util');
describe('Sprint 13 API registry database', () => {
    let userId, layerId, registryId, keyId, table;
    beforeAll(async () => {
        const u = await db.query(
            `SELECT id FROM auth.users WHERE deleted_at IS NULL ORDER BY id LIMIT 1`,
        );
        if (!u.rows[0]) {
            throw new Error('Sprint 13 integration requires a fixture auth user');
        }
        userId = u.rows[0].id;
        table = `s13_${Date.now()}`;
        await db.query(
            `CREATE TABLE gis.${table}(source_fid varchar(120) PRIMARY KEY,name text,kind text,geom geometry(Point,5899) NOT NULL)`,
        );
        const l = await db.query(
            `INSERT INTO gis.layers(code,name_vi,storage_kind,table_name,geometry_type,srid,publish_status,metadata,created_by) VALUES($1,$2,'postgis',$3,'POINT',5899,'published',$4,$5) RETURNING id`,
            [
                `s13_${Date.now()}`,
                'Sprint 13 fixture',
                table,
                {
                    idField: 'source_fid',
                    displayFields: ['name', 'kind'],
                    searchFields: ['name'],
                    editableFields: ['name', 'kind'],
                },
                userId,
            ],
        );
        layerId = l.rows[0].id;
        const r = await db.query(
            `INSERT INTO apikey.registries(layer_id,slug,name,read_fields,write_fields,search_fields,allowed_methods,default_sort_field,created_by,updated_by) VALUES($1,$2,'Fixture',$3,$4,$5,$6,'name',$7,$7) RETURNING id`,
            [
                layerId,
                `s13-${Date.now()}`,
                ['name', 'kind'],
                ['name'],
                ['name'],
                ['GET', 'PUT'],
                userId,
            ],
        );
        registryId = r.rows[0].id;
        const signed = token.sign({
            keyId: 'a0f90eb2-78e5-4d4c-8646-2eb50bbfeaae',
            registryId,
            layerId,
            scopes: ['features:read'],
            tokenVersion: 1,
            expiresInSeconds: 600,
        });
        const k = await db.query(
            `INSERT INTO apikey.keys(id,registry_id,name,consumer,jti_hash,token_hint,scopes,quota_per_minute,expires_at,created_by) VALUES($1,$2,'Fixture','Jest',$3,$4,$5,2,$6,$7) RETURNING id`,
            [
                'a0f90eb2-78e5-4d4c-8646-2eb50bbfeaae',
                registryId,
                signed.jtiHash,
                signed.tokenHint,
                ['features:read'],
                signed.expiresAt,
                userId,
            ],
        );
        keyId = k.rows[0].id;
    });
    afterAll(async () => {
        await db.query(`DELETE FROM apikey.quota_windows WHERE key_id=$1`, [keyId]);
        await db.query(`DELETE FROM apikey.keys WHERE id=$1`, [keyId]);
        await db.query(`DELETE FROM apikey.registries WHERE id=$1`, [registryId]);
        await db.query(`DELETE FROM gis.layers WHERE id=$1`, [layerId]);
        await db.query(`DROP TABLE IF EXISTS gis.${table}`);
        db.stopPoolMonitor();
        await db.pool.end();
    });
    test('quota increment is atomic', async () => {
        const run = () =>
            db.query(
                `INSERT INTO apikey.quota_windows(key_id,window_start,request_count) VALUES($1,date_trunc('minute',NOW()),1) ON CONFLICT(key_id,window_start) DO UPDATE SET request_count=apikey.quota_windows.request_count+1 RETURNING request_count`,
                [keyId],
            );
        const results = await Promise.all([run(), run(), run()]);
        expect(Math.max(...results.map((x) => x.rows[0].request_count))).toBe(3);
    });
    test('call logs are immutable', async () => {
        const client = await db.getClient();
        try {
            await client.query('BEGIN');
            const x = await client.query(
                `INSERT INTO apikey.call_logs(registry_id,key_id,method,path,status_code,duration_ms) VALUES($1,$2,'GET','/fixture',200,1) RETURNING id`,
                [registryId, keyId],
            );
            await expect(
                client.query(`DELETE FROM apikey.call_logs WHERE id=$1`, [x.rows[0].id]),
            ).rejects.toThrow(/immutable/);
        } finally {
            await client.query('ROLLBACK');
            client.release();
        }
    });
});
