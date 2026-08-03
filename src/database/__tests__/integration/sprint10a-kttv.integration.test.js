'use strict';
if (process.env.DB_NAME !== 'campha_test') {
    throw new Error('Sprint 10a KTTV integration only runs on campha_test');
}
// Mock chỉ thay passport bằng header test — permissions gắn vào req.user vẫn là
// permissions THẬT đọc từ auth.roles trong beforeAll. Cùng pattern với
// sprint7-rbac.integration.test.js.
jest.mock('../../../middlewares/auth.middleware', () => {
    const { Api401Error } = require('../../../core/error.response');
    const user = (req) => {
        const role = req.get('x-test-role');
        const permissions = req.get('x-test-permissions');
        if (!role || !permissions) {
            return null;
        }
        return { id: 1, role, org_id: 1, role_permissions: JSON.parse(permissions) };
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
        requireRole: () => (_req, _res, next) => next(),
        requirePermission: () => (_req, _res, next) => next(),
        hasPermission: () => true,
    };
});

const request = require('supertest');
const db = require('../../../configs/database');
const app = require('../../../app');

const ROLES = ['citizen', 'system_admin', 'ubnd_tp', 'so_tnmt', 'so_xd'];
const PREFIX = 'it_s10a_';
let rolePermissions;

const authAs = (req, role) =>
    req
        .set('x-test-role', role)
        .set('x-test-permissions', JSON.stringify(rolePermissions.get(role)));

const cleanup = async () => {
    await db.query(`DELETE FROM kttv.sources WHERE name LIKE $1`, [`${PREFIX}%`]);
    await db.query(`DELETE FROM kttv.stations WHERE code LIKE $1`, [`${PREFIX}%`]);
};

describe('Sprint 10a KTTV — sources/stations RBAC + SSRF (HTTP integration)', () => {
    beforeAll(async () => {
        await cleanup();
        rolePermissions = new Map();
        for (const role of ROLES) {
            const {
                rows: [row],
            } = await db.query('SELECT permissions FROM auth.roles WHERE code=$1', [role]);
            if (!row) {
                throw new Error(`Fixture role missing in auth.roles: ${role}`);
            }
            rolePermissions.set(role, row.permissions);
        }
    });
    afterAll(async () => {
        await cleanup();
        db.stopPoolMonitor();
        await db.pool.end();
    });

    test('anonymous bị từ chối 401 ở tầng HTTP (chưa chạm RBAC)', async () => {
        await request(app).get('/api/v1/admin/kttv/sources').expect(401);
        await request(app).post('/api/v1/admin/kttv/sources').send({}).expect(401);
        await request(app).get('/api/v1/admin/kttv/stations').expect(401);
    });

    test('citizen không có kttv:read -> 403', async () => {
        await authAs(request(app).get('/api/v1/admin/kttv/sources'), 'citizen').expect(403);
        await authAs(request(app).get('/api/v1/admin/kttv/stations'), 'citizen').expect(403);
    });

    test('ubnd_tp có kttv:read nhưng KHÔNG có create_source -> 200 GET, 403 POST', async () => {
        await authAs(request(app).get('/api/v1/admin/kttv/sources'), 'ubnd_tp').expect(200);
        const res = await authAs(request(app).post('/api/v1/admin/kttv/sources'), 'ubnd_tp').send({
            name: `${PREFIX}should-fail`,
            serviceType: 'REST',
            endpointUrl: 'https://api.open-meteo.com/v1/forecast',
        });
        expect(res.status).toBe(403);
    });

    test.each(['system_admin', 'so_tnmt', 'so_xd'])(
        '%s tạo được nguồn KTTV qua HTTP thật, không lộ credential_enc',
        async (role) => {
            const res = await authAs(request(app).post('/api/v1/admin/kttv/sources'), role).send({
                name: `${PREFIX}${role}`,
                serviceType: 'REST',
                endpointUrl:
                    'https://api.open-meteo.com/v1/forecast?latitude=21.0089&longitude=107.3368&current=temperature_2m',
                isEnabled: true,
            });
            expect(res.status).toBe(201);
            expect(res.body.data).not.toHaveProperty('credential_enc');
            expect(res.body.data).toMatchObject({ hasCredential: false });
        },
    );

    test('chỉ TNMT được set displayConfig — system_admin bị 403', async () => {
        const res = await authAs(
            request(app).post('/api/v1/admin/kttv/sources'),
            'system_admin',
        ).send({
            name: `${PREFIX}display-cfg-blocked`,
            serviceType: 'REST',
            endpointUrl: 'https://api.open-meteo.com/v1/forecast',
            displayConfig: { colorScale: 'blue' },
        });
        expect(res.status).toBe(403);
    });
    test('so_tnmt được set displayConfig', async () => {
        const res = await authAs(request(app).post('/api/v1/admin/kttv/sources'), 'so_tnmt').send({
            name: `${PREFIX}display-cfg-ok`,
            serviceType: 'REST',
            endpointUrl: 'https://api.open-meteo.com/v1/forecast',
            displayConfig: { colorScale: 'blue' },
        });
        expect(res.status).toBe(201);
    });

    describe('US-10a.3 + US-10a.4 — test-connection thật (yêu cầu mạng ra ngoài)', () => {
        test('kết nối thành công tới nguồn hợp lệ trong allowlist, trả về preview thật', async () => {
            const created = await authAs(
                request(app).post('/api/v1/admin/kttv/sources'),
                'system_admin',
            ).send({
                name: `${PREFIX}test-connection-ok`,
                serviceType: 'REST',
                endpointUrl:
                    'https://api.open-meteo.com/v1/forecast?latitude=21.0089&longitude=107.3368&current=temperature_2m',
                isEnabled: true,
            });
            expect(created.status).toBe(201);

            const res = await authAs(
                request(app).post(
                    `/api/v1/admin/kttv/sources/${created.body.data.id}/test-connection`,
                ),
                'system_admin',
            );
            expect(res.status).toBe(200);
            expect(res.body.data.status).toBe(200);
            expect(res.body.data.preview).toContain('latitude');
        });

        test('BẰNG CHỨNG CHẶN SSRF: 169.254.169.254 (cloud metadata) bị từ chối 422', async () => {
            const created = await authAs(
                request(app).post('/api/v1/admin/kttv/sources'),
                'system_admin',
            ).send({
                name: `${PREFIX}ssrf-metadata`,
                serviceType: 'REST',
                endpointUrl: 'http://169.254.169.254/latest/meta-data/',
                isEnabled: true,
            });
            expect(created.status).toBe(201);

            const res = await authAs(
                request(app).post(
                    `/api/v1/admin/kttv/sources/${created.body.data.id}/test-connection`,
                ),
                'system_admin',
            );
            expect(res.status).toBe(422);
            expect(res.body.errors[0]).toMatch(/SSRF_HOST_NOT_ALLOWED|SSRF_BLOCKED_IP/);
        });

        test('BẰNG CHỨNG CHẶN SSRF: 127.0.0.1 (loopback) bị từ chối 422', async () => {
            const created = await authAs(
                request(app).post('/api/v1/admin/kttv/sources'),
                'system_admin',
            ).send({
                name: `${PREFIX}ssrf-loopback`,
                serviceType: 'REST',
                endpointUrl: 'http://127.0.0.1:9999/secret',
                isEnabled: true,
            });
            expect(created.status).toBe(201);

            const res = await authAs(
                request(app).post(
                    `/api/v1/admin/kttv/sources/${created.body.data.id}/test-connection`,
                ),
                'system_admin',
            );
            expect(res.status).toBe(422);
            expect(res.body.errors[0]).toMatch(/SSRF_HOST_NOT_ALLOWED|SSRF_BLOCKED_IP/);
        });

        test('citizen không có test_source -> 403 (không được phép thử kết nối)', async () => {
            const created = await authAs(
                request(app).post('/api/v1/admin/kttv/sources'),
                'system_admin',
            ).send({
                name: `${PREFIX}test-connection-citizen`,
                serviceType: 'REST',
                endpointUrl: 'https://api.open-meteo.com/v1/forecast',
                isEnabled: true,
            });
            expect(created.status).toBe(201);

            const res = await authAs(
                request(app).post(
                    `/api/v1/admin/kttv/sources/${created.body.data.id}/test-connection`,
                ),
                'citizen',
            );
            expect(res.status).toBe(403);
        });
    });

    describe('stations — RBAC + optimistic lock', () => {
        test('so_xd tạo được trạm; PATCH một phần không làm mất alarm_level đã set', async () => {
            const code = `${PREFIX}ST01`;
            const create = await authAs(
                request(app).post('/api/v1/admin/kttv/stations'),
                'so_xd',
            ).send({
                code,
                name: 'Trạm test Sprint 10a',
                longitude: 107.3368,
                latitude: 21.0089,
                alarmLevel1M: 2.5,
                alarmLevel2M: 3.5,
            });
            expect(create.status).toBe(201);
            expect(create.body.data).toMatchObject({ longitude: 107.3368, latitude: 21.0089 });

            const patch = await authAs(
                request(app).patch(`/api/v1/admin/kttv/stations/${code}`),
                'so_xd',
            ).send({
                name: 'Trạm test (đã đổi tên)',
                expectedUpdatedAt: create.body.data.updated_at,
            });
            expect(patch.status).toBe(200);
            expect(patch.body.data.alarm_level_1_m).toBe(create.body.data.alarm_level_1_m);
            expect(patch.body.data.alarm_level_2_m).toBe(create.body.data.alarm_level_2_m);
        });

        test('PATCH với expectedUpdatedAt cũ (đã đổi) -> 409 optimistic lock', async () => {
            const code = `${PREFIX}ST02`;
            const create = await authAs(
                request(app).post('/api/v1/admin/kttv/stations'),
                'so_xd',
            ).send({
                code,
                name: 'Trạm test lock',
                longitude: 107.3,
                latitude: 21.0,
            });
            expect(create.status).toBe(201);

            const res = await authAs(
                request(app).patch(`/api/v1/admin/kttv/stations/${code}`),
                'so_xd',
            ).send({ name: 'x', expectedUpdatedAt: new Date('2020-01-01').toISOString() });
            expect(res.status).toBe(409);
            expect(res.body.errors).toContain('OPTIMISTIC_LOCK_CONFLICT');
        });

        test('ubnd_tp không có manage_stations -> 403', async () => {
            const res = await authAs(
                request(app).post('/api/v1/admin/kttv/stations'),
                'ubnd_tp',
            ).send({
                code: `${PREFIX}ST03`,
                name: 'x',
                longitude: 107.3,
                latitude: 21.0,
            });
            expect(res.status).toBe(403);
        });

        test('xóa trạm không tồn tại -> 404', async () => {
            const res = await authAs(
                request(app).delete(
                    `/api/v1/admin/kttv/stations/${PREFIX}NOPE?expectedUpdatedAt=${encodeURIComponent(new Date().toISOString())}`,
                ),
                'so_xd',
            );
            expect(res.status).toBe(404);
        });
    });
});
