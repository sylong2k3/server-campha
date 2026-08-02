'use strict';
if (process.env.DB_NAME !== 'campha_test') {
    throw new Error('Sprint 7 integration only runs on campha_test');
}
jest.mock('../../../middlewares/auth.middleware', () => {
    const { Api401Error } = require('../../../core/error.response');
    const user = (req) => {
        const role = req.get('x-test-role');
        if (!role) {
            return null;
        }
        const manager = role !== 'citizen';
        return {
            id: Number(req.get('x-test-user-id')),
            role,
            org_id: 1,
            role_permissions: {
                stats: { view: true, ...(manager && { export: true }) },
                ...(manager && { spatial: { analyze: true } }),
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
const PREFIX = 'it_s7_';
let userId, flood2025, flood2026, boundary;
const auth = (req, role = 'so_tnmt') =>
    req.set('x-test-role', role).set('x-test-user-id', String(userId));
const cleanup = async () => {
    await db.query(
        `DELETE FROM analytics.area_statistics WHERE source_id IN(SELECT s.id FROM analytics.data_sources s JOIN gis.layers l ON l.id=s.layer_id WHERE l.code LIKE $1) OR boundary_source_id IN(SELECT s.id FROM analytics.data_sources s JOIN gis.layers l ON l.id=s.layer_id WHERE l.code LIKE $1)`,
        [`${PREFIX}%`],
    );
    await db.query(
        `DELETE FROM analytics.data_sources WHERE layer_id IN(SELECT id FROM gis.layers WHERE code LIKE $1)`,
        [`${PREFIX}%`],
    );
    await db.query(`DELETE FROM gis.layers WHERE code LIKE $1`, [`${PREFIX}%`]);
    for (const table of [`${PREFIX}flood_2025`, `${PREFIX}flood_2026`, `${PREFIX}boundary`]) {
        await db.query(`DROP TABLE IF EXISTS gis."${table}"`);
    }
};
const createLayer = async (code, name) => {
    const {
        rows: [layer],
    } = await db.query(
        `INSERT INTO gis.layers(code,name_vi,geometry_type,srid,storage_kind,table_name,publish_status,created_by) VALUES($1,$2,'MULTIPOLYGON',5899,'postgis',$1,'published',$3) RETURNING *`,
        [code, name, userId],
    );
    await db.query(
        `INSERT INTO gis.layer_permissions(layer_id,role_code,can_view,can_export) VALUES($1,'so_tnmt',true,true),($1,'system_admin',true,true),($1,'citizen',true,false)`,
        [layer.id],
    );
    return layer;
};
describe('Sprint 7 spatial statistics integration', () => {
    beforeAll(async () => {
        await cleanup();
        userId = (
            await db.query('SELECT id FROM auth.users WHERE deleted_at IS NULL ORDER BY id LIMIT 1')
        ).rows[0].id;
        await db.query(
            `CREATE TABLE gis.${PREFIX}flood_2025(id serial primary key,kind text,geom geometry(MultiPolygon,5899));CREATE TABLE gis.${PREFIX}flood_2026(id serial primary key,kind text,geom geometry(MultiPolygon,5899));CREATE TABLE gis.${PREFIX}boundary(id serial primary key,ward_code text,ward_name text,geom geometry(MultiPolygon,5899));`,
        );
        await db.query(
            `INSERT INTO gis.${PREFIX}flood_2025(kind,geom) VALUES('flood',ST_Multi(ST_MakeEnvelope(0,0,100,100,5899)));INSERT INTO gis.${PREFIX}flood_2026(kind,geom) VALUES('flood',ST_Multi(ST_MakeEnvelope(0,0,150,100,5899)));INSERT INTO gis.${PREFIX}boundary(ward_code,ward_name,geom) VALUES('P1','Phường 1',ST_Multi(ST_MakeEnvelope(0,0,75,100,5899))),('P2','Phường 2',ST_Multi(ST_MakeEnvelope(75,0,200,100,5899)));`,
        );
        flood2025 = await createLayer(`${PREFIX}flood_2025`, 'Ngập 2025');
        flood2026 = await createLayer(`${PREFIX}flood_2026`, 'Ngập 2026');
        boundary = await createLayer(`${PREFIX}boundary`, 'Ranh giới');
    });
    afterAll(async () => {
        await cleanup();
        db.stopPoolMonitor();
        await db.pool.end();
    });
    test('anonymous denied; citizen reads but cannot register', async () => {
        await request(app).get('/api/v1/statistics/sources').expect(401);
        await auth(request(app).get('/api/v1/statistics/sources'), 'citizen').expect(200);
        await auth(request(app).post('/api/v1/admin/statistics/sources'), 'citizen')
            .send({
                layerId: flood2025.id,
                sourceType: 'flood',
                observedYear: 2025,
                geometryColumn: 'geom',
                labelColumn: 'kind',
            })
            .expect(403);
    });
    test('registers sources, refreshes exact area and administrative breakdown', async () => {
        const register = async (body) =>
            auth(request(app).post('/api/v1/admin/statistics/sources')).send(body).expect(201);
        const b = await register({
            layerId: boundary.id,
            sourceType: 'administrative_boundary',
            geometryColumn: 'geom',
            administrativeCodeColumn: 'ward_code',
            administrativeNameColumn: 'ward_name',
        });
        const a = await register({
            layerId: flood2025.id,
            sourceType: 'flood',
            observedYear: 2025,
            geometryColumn: 'geom',
            labelColumn: 'kind',
        });
        const c = await register({
            layerId: flood2026.id,
            sourceType: 'flood',
            observedYear: 2026,
            geometryColumn: 'geom',
            labelColumn: 'kind',
        });
        await auth(request(app).post(`/api/v1/admin/statistics/sources/${a.body.data.id}/refresh`))
            .send({ boundarySourceId: b.body.data.id })
            .expect(200);
        await auth(request(app).post(`/api/v1/admin/statistics/sources/${c.body.data.id}/refresh`))
            .send({ boundarySourceId: b.body.data.id })
            .expect(200);
        const rows = await auth(
            request(app).get('/api/v1/statistics/areas?type=flood&year=2025'),
        ).expect(200);
        expect(rows.body.data).toHaveLength(2);
        expect(rows.body.data.reduce((sum, row) => sum + Number(row.area_m2), 0)).toBe(10000);
    });
    test('compares same type and rejects identifier injection', async () => {
        const sources = await auth(
            request(app).get('/api/v1/statistics/sources?type=flood'),
        ).expect(200);
        const before = sources.body.data.find((row) => row.observed_year === 2025),
            after = sources.body.data.find((row) => row.observed_year === 2026);
        const compared = await auth(
            request(app).get(
                `/api/v1/statistics/compare?beforeSourceId=${before.id}&afterSourceId=${after.id}`,
            ),
        ).expect(200);
        expect(Number(compared.body.data.added_m2)).toBe(5000);
        await auth(request(app).post('/api/v1/admin/statistics/sources'))
            .send({
                layerId: flood2025.id,
                sourceType: 'flood',
                observedYear: 2030,
                geometryColumn: 'geom;drop',
            })
            .expect(400);
    });
});
