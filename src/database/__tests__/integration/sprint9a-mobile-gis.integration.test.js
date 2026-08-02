'use strict';
if (process.env.DB_NAME !== 'campha_test') {
    throw new Error('Sprint 9a integration only runs on campha_test');
}
jest.mock('../../../middlewares/auth.middleware', () => {
    const { Api401Error } = require('../../../core/error.response');
    const user = (req) => {
        const role = req.get('x-test-role');
        if (!role) {
            return null;
        }
        return {
            id: Number(req.get('x-test-user-id')),
            role,
            org_id: 1,
            role_permissions: {
                map: { view: true, view_attributes: true, locate: true, measure: true, draw: true },
                weather: { read: true },
            },
        };
    };
    return {
        verifyToken: (req, _res, next) => {
            req.user = user(req);
            next(req.user ? undefined : new Api401Error('Login required'));
        },
        enforcePasswordChange: (_req, _res, next) => next(),
        optionalAuth: (req, _res, next) => {
            req.user = user(req);
            next();
        },
        requireRole: () => () => {},
        requirePermission: () => () => {},
        hasPermission: () => true,
    };
});
const request = require('supertest');
const app = require('../../../app');
const db = require('../../../configs/database');
const PREFIX = 'it_s9a_';
let ownerId, otherId, layer, draft;
const auth = (req, id = ownerId) =>
    req.set('x-test-role', 'citizen').set('x-test-user-id', String(id));
const cleanup = async () => {
    if (ownerId) {
        await db.query('DELETE FROM gis.mobile_drafts WHERE owner_user_id=ANY($1::bigint[])', [
            [ownerId, otherId],
        ]);
    }
    await db.query('DELETE FROM gis.layers WHERE code=$1', [`${PREFIX}points`]);
    await db.query(`DROP TABLE IF EXISTS gis.${PREFIX}points`);
};
describe('Sprint 9a mobile GIS integration', () => {
    beforeAll(async () => {
        const users = (
            await db.query('SELECT id FROM auth.users WHERE deleted_at IS NULL ORDER BY id LIMIT 2')
        ).rows;
        [ownerId, otherId] = users.map((row) => row.id);
        await cleanup();
        await db.query(
            `CREATE TABLE gis.${PREFIX}points(source_fid int primary key,name text,geom geometry(Point,4326));INSERT INTO gis.${PREFIX}points VALUES(1,'Trung tâm',ST_SetSRID(ST_MakePoint(107.335,21.01),4326))`,
        );
        layer = (
            await db.query(
                `INSERT INTO gis.layers(code,name_vi,geometry_type,srid,storage_kind,table_name,publish_status,is_public,min_zoom,max_zoom,metadata,created_by) VALUES($1,'Điểm mobile','POINT',4326,'postgis',$1,'published',true,0,22,'{"displayFields":["name"],"idField":"source_fid"}'::jsonb,$2) RETURNING *`,
                [`${PREFIX}points`, ownerId],
            )
        ).rows[0];
    });
    afterAll(async () => {
        await cleanup();
        db.stopPoolMonitor();
        await db.pool.end();
    });
    test('returns MVT, feature and nearby through ACL-safe registry', async () => {
        const tile = await request(app).get(`/api/v1/mobile/layers/${layer.id}/tiles/0/0/0.mvt`);
        expect(tile.status).toBe(200);
        expect(tile.headers['content-type']).toMatch(/mapbox-vector-tile/);
        expect(Number(tile.headers['content-length'])).toBeGreaterThan(0);
        expect(
            (await request(app).get(`/api/v1/mobile/layers/${layer.id}/features/1`)).status,
        ).toBe(200);
        const near = await request(app).get(
            `/api/v1/mobile/layers/${layer.id}/nearby?longitude=107.335&latitude=21.01&radiusMeters=100`,
        );
        expect(near.status).toBe(200);
        expect(near.body.data[0].name).toBe('Trung tâm');
    });
    test('measures with EPSG:5899 and isolates drafts by owner', async () => {
        const measured = await auth(request(app).post('/api/v1/mobile/measure')).send({
            geometry: {
                type: 'LineString',
                coordinates: [
                    [107.335, 21.01],
                    [107.336, 21.01],
                ],
            },
        });
        expect(measured.status).toBe(200);
        expect(Number(measured.body.data.length_m)).toBeGreaterThan(100);
        const created = await auth(request(app).post('/api/v1/mobile/drafts')).send({
            title: 'Phác thảo hiện trường',
            geometry: { type: 'Point', coordinates: [107.335, 21.01] },
        });
        expect(created.status).toBe(201);
        draft = created.body.data;
        expect(
            (await auth(request(app).get(`/api/v1/mobile/drafts/${draft.id}`), otherId)).status,
        ).toBe(404);
        expect(
            (
                await auth(
                    request(app).delete(
                        `/api/v1/mobile/drafts/${draft.id}?expectedUpdatedAt=${encodeURIComponent(new Date(draft.updated_at).toISOString())}`,
                    ),
                )
            ).status,
        ).toBe(200);
    });
    test('weather endpoint returns bounded data or an operational unavailable error', async () => {
        const response = await request(app).get(
            '/api/v1/mobile/weather/current?longitude=107.335&latitude=21.01',
        );
        expect([200, 503]).toContain(response.status);
        if (response.status === 200) {
            expect(response.body.data).toEqual(
                expect.objectContaining({
                    temperatureC: expect.any(Number),
                    windSpeedMps: expect.any(Number),
                }),
            );
        } else {
            expect(
                response.body.errors.some((code) =>
                    ['WEATHER_UNAVAILABLE', 'WEATHER_UPSTREAM_UNAVAILABLE'].includes(code),
                ),
            ).toBe(true);
        }
    });
});
