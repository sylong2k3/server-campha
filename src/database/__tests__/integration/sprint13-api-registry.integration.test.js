'use strict';
process.env.API_SHARE_JWT_SECRET = 'i'.repeat(48);
const request = require('supertest'),
    db = require('../../../configs/database'),
    token = require('../../../utils/api-share-token.util'),
    app = require('../../../app'),
    { randomUUID } = require('crypto');
const WRITE_SCOPES = ['features:read', 'features:create', 'features:update', 'features:delete'];
describe('Sprint 13 API registry database', () => {
    let userId, layerId, registryId, keyId, table, slug, shareToken;
    beforeAll(async () => {
        if (process.env.DB_NAME !== 'campha_test') {
            throw new Error('Sprint 13 integration requires campha_test');
        }
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
        await db.query(
            `INSERT INTO gis.${table} VALUES('fixture-1','Alpha','road',ST_Transform(ST_SetSRID(ST_MakePoint(107.335,21.01),4326),5899))`,
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
        slug = `s13-${Date.now()}`;
        const r = await db.query(
            `INSERT INTO apikey.registries(layer_id,slug,name,read_fields,write_fields,search_fields,allowed_methods,default_sort_field,created_by,updated_by) VALUES($1,$2,'Fixture',$3,$4,$5,$6,'name',$7,$7) RETURNING id`,
            [
                layerId,
                slug,
                ['name', 'kind'],
                ['name'],
                ['name'],
                ['GET', 'POST', 'PUT', 'DELETE'],
                userId,
            ],
        );
        registryId = r.rows[0].id;
        keyId = randomUUID();
        const signed = token.sign({
            keyId,
            registryId,
            layerId,
            scopes: WRITE_SCOPES,
            tokenVersion: 1,
            expiresInSeconds: 600,
        });
        shareToken = signed.token;
        const k = await db.query(
            `INSERT INTO apikey.keys(id,registry_id,name,consumer,jti_hash,token_hint,scopes,quota_per_minute,expires_at,created_by,approved_by) VALUES($1,$2,'Fixture','Jest',$3,$4,$5,50,$6,$7,$7) RETURNING id`,
            [
                keyId,
                registryId,
                signed.jtiHash,
                signed.tokenHint,
                WRITE_SCOPES,
                signed.expiresAt,
                userId,
            ],
        );
        expect(k.rows[0].id).toBe(keyId);
    });
    afterAll(async () => {
        await db.query(
            'ALTER TABLE apikey.call_logs DISABLE TRIGGER trigger_api_call_logs_immutable',
        );
        await db.query(
            'ALTER TABLE apikey.feature_mutations DISABLE TRIGGER trigger_api_feature_mutations_immutable',
        );
        await db.query(
            'ALTER TABLE gis.feature_versions DISABLE TRIGGER trigger_feature_versions_immutable',
        );
        try {
            await db.query(`DELETE FROM apikey.call_logs WHERE key_id=$1`, [keyId]);
            await db.query(`DELETE FROM apikey.feature_mutations WHERE key_id=$1`, [keyId]);
            await db.query(`DELETE FROM gis.feature_versions WHERE api_key_id=$1`, [keyId]);
        } finally {
            await db.query(
                'ALTER TABLE gis.feature_versions ENABLE TRIGGER trigger_feature_versions_immutable',
            );
            await db.query(
                'ALTER TABLE apikey.feature_mutations ENABLE TRIGGER trigger_api_feature_mutations_immutable',
            );
            await db.query(
                'ALTER TABLE apikey.call_logs ENABLE TRIGGER trigger_api_call_logs_immutable',
            );
        }
        await db.query(`DELETE FROM apikey.quota_windows WHERE key_id=$1`, [keyId]);
        await db.query(`DELETE FROM apikey.keys WHERE id=$1`, [keyId]);
        await db.query(`DELETE FROM apikey.registries WHERE id=$1`, [registryId]);
        await db.query(`DROP TABLE IF EXISTS gis.${table}`);
        await db.query(`DELETE FROM gis.layers WHERE id=$1`, [layerId]);
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
    test('shared HTTP enforces search, quota headers and immediate revoke', async () => {
        await db.query(`DELETE FROM apikey.quota_windows WHERE key_id=$1`, [keyId]);
        const auth = () =>
            request(app)
                .get(`/api/v1/shared/${slug}/features?q=Alpha&sortBy=name`)
                .set('authorization', `Bearer ${shareToken}`);
        const ok = await auth().expect(200);
        expect(ok.headers['ratelimit-limit']).toBe('50');
        expect(ok.body.data.items[0]).toMatchObject({ feature_id: 'fixture-1', name: 'Alpha' });
        await db.query(`UPDATE apikey.keys SET quota_per_minute=1 WHERE id=$1`, [keyId]);
        await db.query(`DELETE FROM apikey.quota_windows WHERE key_id=$1`, [keyId]);
        await auth().expect(200);
        await auth().expect(429);
        await db.query(`UPDATE apikey.keys SET revoked_at=NOW(),revoked_by=$2 WHERE id=$1`, [
            keyId,
            userId,
        ]);
        await auth().expect(401);
        await db.query(
            `UPDATE apikey.keys SET revoked_at=NULL,revoked_by=NULL,quota_per_minute=50 WHERE id=$1`,
            [keyId],
        );
    });
    test('shared CRUD preserves versions, key audit and deleted ID tombstone', async () => {
        await db.query(`DELETE FROM apikey.quota_windows WHERE key_id=$1`, [keyId]);
        const headers = (req) => req.set('authorization', `Bearer ${shareToken}`);
        const created = await headers(request(app).post(`/api/v1/shared/${slug}/features`))
            .send({
                featureId: 'external-1',
                attributes: { name: 'External' },
                geometry: { type: 'Point', coordinates: [107.336, 21.011] },
            })
            .expect(201);
        expect(Number(created.body.data.version)).toBe(1);
        await headers(request(app).put(`/api/v1/shared/${slug}/features/external-1`))
            .send({ baseVersion: 0, attributes: { name: 'Stale' } })
            .expect(400);
        const updated = await headers(
            request(app).put(`/api/v1/shared/${slug}/features/external-1`),
        )
            .send({ baseVersion: 1, attributes: { name: 'Updated' } })
            .expect(200);
        expect(Number(updated.body.data.version)).toBe(2);
        const {
            rows: [history],
        } = await db.query(
            `SELECT api_key_id FROM gis.feature_versions WHERE layer_id=$1 AND feature_id='external-1' AND version=2`,
            [layerId],
        );
        expect(history.api_key_id).toBe(keyId);
        await headers(request(app).delete(`/api/v1/shared/${slug}/features/external-1`))
            .send({ baseVersion: 1 })
            .expect(409);
        await headers(request(app).delete(`/api/v1/shared/${slug}/features/external-1`))
            .send({ baseVersion: 2 })
            .expect(200);
        await headers(request(app).post(`/api/v1/shared/${slug}/features`))
            .send({
                featureId: 'external-1',
                attributes: { name: 'Reuse' },
                geometry: { type: 'Point', coordinates: [107.336, 21.011] },
            })
            .expect(409);
        const { rows } = await db.query(
            `SELECT action,version FROM apikey.feature_mutations WHERE key_id=$1 AND feature_id='external-1' ORDER BY version`,
            [keyId],
        );
        expect(rows).toEqual([
            { action: 'create', version: '1' },
            { action: 'delete', version: '3' },
        ]);
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
