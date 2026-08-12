'use strict';
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
                map: { route: true },
                ...(role === 'so_tnmt' && { map_feature: { update: true } }),
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
const request = require('supertest'),
    db = require('../../../configs/database'),
    app = require('../../../app');
const originalFetch = global.fetch;
const mapboxFetch = jest.fn(async (url) => {
    if (!String(url).startsWith('https://api.mapbox.com/directions/')) {
        return originalFetch(url);
    }
    return {
        ok: true,
        status: 200,
        json: async () => ({
            code: 'Ok',
            routes: [
                {
                    distance: 1012.45,
                    duration: 120,
                    geometry: {
                        type: 'LineString',
                        coordinates: [
                            [107.3301, 21],
                            [107.3399, 21],
                        ],
                    },
                },
            ],
            waypoints: [{ location: [107.3301, 21] }, { location: [107.3399, 21] }],
        }),
    };
});
const PREFIX = 'it_s9b_';
let userId, layerId;
const clientId = '785d9ba2-4d51-4d3a-b8af-28d285dc36d2',
    change1 = '8fd3461c-8a73-423b-8cca-e513696bba25',
    change2 = '5f046893-a0dd-4d3f-9180-ad32159ec45a';
const auth = (req, role = 'so_tnmt') =>
    req.set('x-test-role', role).set('x-test-user-id', String(userId));
const cleanup = async () => {
    await db.query(`DELETE FROM gis.mobile_sync_receipts WHERE client_id=$1`, [clientId]);
    await db.query(
        'ALTER TABLE gis.feature_versions DISABLE TRIGGER trigger_feature_versions_immutable',
    );
    try {
        await db.query(`DELETE FROM gis.layers WHERE code LIKE $1`, [`${PREFIX}%`]);
    } finally {
        await db.query(
            'ALTER TABLE gis.feature_versions ENABLE TRIGGER trigger_feature_versions_immutable',
        );
    }
    await db.query(`DROP TABLE IF EXISTS gis.${PREFIX}roads`);
};
beforeAll(async () => {
    process.env.MAPBOX_DIRECTIONS_TOKEN = 'pk.integration-test-not-real';
    global.fetch = mapboxFetch;
    if (process.env.DB_NAME !== 'campha_test') {
        throw new Error('Sprint 9b integration requires campha_test');
    }
    await cleanup();
    const {
        rows: [u],
    } = await db.query(`SELECT id FROM auth.users WHERE deleted_at IS NULL ORDER BY id LIMIT 1`);
    userId = u.id;
    await db.query(
        `CREATE TABLE gis.${PREFIX}roads(source_fid BIGINT PRIMARY KEY,name VARCHAR(100),speed INT,geom geometry(LineString,4326) NOT NULL)`,
    );
    await db.query(
        `INSERT INTO gis.${PREFIX}roads VALUES(1,'A',30,ST_GeomFromText('LINESTRING(107.33 21,107.335 21)',4326)),(2,'B',30,ST_GeomFromText('LINESTRING(107.335 21,107.34 21)',4326)),(3,'C',30,ST_GeomFromText('LINESTRING(107.335 21,107.335 21.005)',4326))`,
    );
    const {
        rows: [l],
    } = await db.query(
        `INSERT INTO gis.layers(code,name_vi,category,geometry_type,srid,storage_kind,table_name,is_public,publish_status,metadata,created_by) VALUES($1,'IT roads','giao thông','LINESTRING',4326,'postgis',$2,true,'published',$3,$4) RETURNING id`,
        [
            `${PREFIX}roads`,
            `${PREFIX}roads`,
            {
                idField: 'source_fid',
                displayFields: ['name', 'speed'],
                editableFields: ['name', 'speed'],
            },
            userId,
        ],
    );
    layerId = l.id;
    await db.query(
        `INSERT INTO gis.layer_permissions(layer_id,role_code,can_view,can_export,can_edit,can_delete) SELECT $1,code,true,true,code='so_tnmt',false FROM auth.roles ON CONFLICT(layer_id,role_code) DO UPDATE SET can_view=true,can_edit=EXCLUDED.can_edit`,
        [layerId],
    );
});
afterAll(async () => {
    global.fetch = originalFetch;
    await cleanup();
    db.stopPoolMonitor();
    await db.pool.end();
});
describe('Sprint 9b routing, versioning and offline sync', () => {
    test('returns a Mapbox shortest route without an internal topology build', async () => {
        const route = await request(app)
            .post('/api/v1/mobile/routes/shortest')
            .send({
                start: [107.3301, 21],
                end: [107.3399, 21],
                profile: 'driving',
            })
            .expect(200);
        expect(route.body.data.provider).toBe('mapbox');
        expect(route.body.data.profile).toBe('driving');
        expect(route.body.data.duration_s).toBe(120);
        expect(route.body.data.geometry.type).toBe('LineString');
        expect(Number(route.body.data.distance_m)).toBeGreaterThan(900);
        expect(mapboxFetch).toHaveBeenCalled();
    });
    test('strictly limits source edits, records history and restores a version', async () => {
        await auth(request(app).patch(`/api/v1/mobile/layers/${layerId}/features/1`), 'citizen')
            .send({ baseVersion: 1, attributes: { name: 'bad' } })
            .expect(403);
        await auth(
            request(app).patch(`/api/v1/mobile/layers/${layerId}/features/1`),
            'system_admin',
        )
            .send({ baseVersion: 1, attributes: { name: 'bad' } })
            .expect(403);
        const changed = await auth(
            request(app).patch(`/api/v1/mobile/layers/${layerId}/features/1`),
        )
            .send({ baseVersion: 1, attributes: { name: 'Changed' } })
            .expect(200);
        expect(changed.body.data.version).toBe(2);
        const history = await auth(
            request(app).get(`/api/v1/mobile/layers/${layerId}/features/1/history`),
        ).expect(200);
        expect(history.body.data.map((x) => Number(x.version))).toEqual([2, 1]);
        const restored = await auth(
            request(app).post(`/api/v1/mobile/layers/${layerId}/features/1/restore/1`),
        )
            .send({ baseVersion: 2 })
            .expect(200);
        expect(restored.body.data.attributes.name).toBe('A');
        expect(restored.body.data.version).toBe(3);
    });
    test('applies offline change once and returns stale conflict without overwriting', async () => {
        const body = {
            clientId,
            changes: [
                {
                    clientChangeId: change1,
                    layerId,
                    featureId: '2',
                    baseVersion: 1,
                    attributes: { name: 'Offline' },
                },
            ],
        };
        const first = await auth(request(app).post('/api/v1/mobile/sync')).send(body).expect(200);
        expect(first.body.data.applied[0].version).toBe(2);
        const replay = await auth(request(app).post('/api/v1/mobile/sync')).send(body).expect(200);
        expect(replay.body.data.applied[0].replayed).toBe(true);
        const stale = await auth(request(app).post('/api/v1/mobile/sync'))
            .send({
                clientId,
                changes: [
                    {
                        clientChangeId: change2,
                        layerId,
                        featureId: '2',
                        baseVersion: 1,
                        attributes: { name: 'Stale' },
                    },
                ],
            })
            .expect(200);
        expect(stale.body.data.conflicts[0].current.version).toBe(2);
        const {
            rows: [row],
        } = await db.query(`SELECT name FROM gis.${PREFIX}roads WHERE source_fid=2`);
        expect(row.name).toBe('Offline');
    });
});
