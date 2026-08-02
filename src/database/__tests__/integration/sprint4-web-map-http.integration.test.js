if (process.env.DB_NAME !== 'campha_test') {
    throw new Error(
        `Sprint 4 HTTP integration chỉ được chạy với DB_NAME=campha_test; received ${process.env.DB_NAME}`,
    );
}

jest.mock('../../../middlewares/auth.middleware', () => ({
    optionalAuth: (req, _res, next) => {
        const role = req.get('x-test-role');
        req.user = role
            ? {
                  id: 1,
                  role,
                  org_id: 1,
                  role_permissions: {
                      map: {
                          view: true,
                          view_attributes: true,
                          search_feature: true,
                          view_legend: true,
                          view_3d: true,
                      },
                  },
              }
            : null;
        next();
    },
    verifyToken: (_req, _res, next) => next(),
    requireRole: () => (_req, _res, next) => next(),
    enforcePasswordChange: (_req, _res, next) => next(),
    requirePermission: () => (_req, _res, next) => next(),
    hasPermission: () => true,
}));

const request = require('supertest');
const app = require('../../../app');
const db = require('../../../configs/database');

const PREFIX = 'it_s4_http_';
let publicLayer;
let privateLayer;

const cleanup = async () => {
    await db.query(`DELETE FROM gis.layers WHERE code LIKE $1`, [`${PREFIX}%`]);
};

describe('Sprint 4 Web Map HTTP integration', () => {
    beforeAll(async () => {
        await cleanup();
        const suffix = Date.now();
        const { rows } = await db.query(
            `
            INSERT INTO gis.layers
                (code,name_vi,category,geometry_type,srid,storage_kind,table_name,
                 is_public,publish_status,metadata,legend_config,min_zoom,max_zoom)
            VALUES
                ($1,'Public HTTP','test','POINT',4326,'postgis',$2,true,'published','{}','{"label":"Public"}',1,20),
                ($3,'Private HTTP','test','POINT',4326,'postgis',$4,false,'published','{}','{"label":"Private"}',2,19)
            RETURNING *`,
            [
                `${PREFIX}public_${suffix}`,
                `${PREFIX}table_public_${suffix}`,
                `${PREFIX}private_${suffix}`,
                `${PREFIX}table_private_${suffix}`,
            ],
        );
        [publicLayer, privateLayer] = rows;
        await db.query(
            `INSERT INTO gis.layer_permissions (layer_id,role_code,can_view) VALUES ($1,'citizen',true)`,
            [privateLayer.id],
        );
    });

    afterAll(async () => {
        await cleanup();
        db.stopPoolMonitor();
        await db.pool.end();
    });

    test('anonymous catalog hides private layer', async () => {
        const response = await request(app).get('/api/v1/web-map/layers').expect(200);
        const ids = response.body.data.map((layer) => Number(layer.id));
        expect(ids).toContain(Number(publicLayer.id));
        expect(ids).not.toContain(Number(privateLayer.id));
    });

    test('all five DB roles obey layer ACL', async () => {
        const roles = ['citizen', 'system_admin', 'ubnd_tp', 'so_tnmt', 'so_xd'];
        for (const role of roles) {
            const response = await request(app)
                .get('/api/v1/web-map/layers')
                .set('x-test-role', role)
                .expect(200);
            const ids = response.body.data.map((layer) => Number(layer.id));
            expect(ids).toContain(Number(publicLayer.id));
            if (role === 'citizen') {
                expect(ids).toContain(Number(privateLayer.id));
            } else {
                expect(ids).not.toContain(Number(privateLayer.id));
            }
        }
    });

    test('legend enforces per-layer ACL and validates search abuse', async () => {
        await request(app).get(`/api/v1/web-map/layers/${privateLayer.id}/legend`).expect(404);
        await request(app)
            .get(`/api/v1/web-map/layers/${privateLayer.id}/legend`)
            .set('x-test-role', 'citizen')
            .expect(200);
        await request(app).get('/api/v1/web-map/features/search?q=x&limit=100').expect(400);
    });

    test('basemap endpoint is anonymous', async () => {
        const response = await request(app).get('/api/v1/web-map/basemaps').expect(200);
        expect(response.body.data).toEqual(
            expect.arrayContaining([expect.objectContaining({ code: 'osm_standard' })]),
        );
    });
});
