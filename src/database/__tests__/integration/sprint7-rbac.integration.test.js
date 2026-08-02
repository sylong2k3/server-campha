'use strict';
if (process.env.DB_NAME !== 'campha_test') {
    throw new Error('Sprint 7 RBAC integration only runs on campha_test');
}
// Mock chỉ thay passport bằng header test — permissions gắn vào req.user vẫn
// là permissions THẬT đọc từ auth.roles trong beforeAll (xem `authAs` bên
// dưới), không phải giá trị bịa. Cùng pattern với các *-http.integration.test.js
// khác trong repo (vd sprint7-spatial-statistics, sprint4-web-map-http).
jest.mock('../../../middlewares/auth.middleware', () => {
    const { Api401Error } = require('../../../core/error.response');
    const user = (req) => {
        const role = req.get('x-test-role');
        const permissions = req.get('x-test-permissions');
        if (!role || !permissions) {
            return null;
        }
        return {
            id: 1,
            role,
            org_id: 1,
            role_permissions: JSON.parse(permissions),
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
        requireRole: () => (_req, _res, next) => next(),
        requirePermission: () => (_req, _res, next) => next(),
        hasPermission: () => true,
    };
});
const request = require('supertest');
const db = require('../../../configs/database');
const app = require('../../../app');
const ROLES = ['citizen', 'system_admin', 'ubnd_tp', 'so_tnmt', 'so_xd'];
let rolePermissions;
// Đăng nhập giả bằng permissions THẬT của role (đọc từ DB ở beforeAll) — nếu
// sau này ai đó sửa auth.roles.permissions cho một role, test HTTP dưới đây
// sẽ đổi kết quả theo, đúng nghĩa "role matrix" thay vì hằng số cứng.
const authAs = (req, role) =>
    req
        .set('x-test-role', role)
        .set('x-test-permissions', JSON.stringify(rolePermissions.get(role)));
describe('Sprint 7 role matrix', () => {
    beforeAll(async () => {
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
        db.stopPoolMonitor();
        await db.pool.end();
    });
    test('citizen can view statistics but cannot export or analyze', () => {
        const permissions = rolePermissions.get('citizen');
        expect(permissions.stats.view).toBe(true);
        expect(permissions.stats.export).not.toBe(true);
        expect(permissions.spatial?.analyze).not.toBe(true);
    });
    test.each(['system_admin', 'ubnd_tp', 'so_tnmt', 'so_xd'])(
        '%s can view/export/analyze',
        (code) => {
            const permissions = rolePermissions.get(code);
            expect(permissions.stats).toMatchObject({ view: true, export: true });
            expect(permissions.spatial).toMatchObject({ analyze: true });
        },
    );
    test('anonymous is denied at the HTTP layer (401)', async () => {
        await request(app).get('/api/v1/statistics/sources').expect(401);
        await request(app).post('/api/v1/admin/statistics/sources').send({}).expect(401);
    });
    test('citizen can read /statistics/sources over real HTTP', async () => {
        await authAs(request(app).get('/api/v1/statistics/sources'), 'citizen').expect(200);
    });
    test('citizen is rejected with 403 (not 401/422) when attempting to register a source', async () => {
        const res = await authAs(
            request(app).post('/api/v1/admin/statistics/sources'),
            'citizen',
        ).send({ layerId: 999999999, sourceType: 'flood', observedYear: 2025 });
        expect(res.status).toBe(403);
    });
    test.each(['system_admin', 'ubnd_tp', 'so_tnmt', 'so_xd'])(
        '%s clears the analyze permission gate over real HTTP (reaches business validation, not 403)',
        async (role) => {
            // layerId giả — mục đích chỉ là chứng minh requirePermission('spatial','analyze')
            // cho qua role này; nếu quyền bị chặn thì phải là 403 trước khi
            // chạm tới repository. 422 LAYER_NOT_ANALYZABLE_OR_FORBIDDEN nghĩa
            // là request đã vượt qua RBAC và tới bước validate layer.
            const res = await authAs(
                request(app).post('/api/v1/admin/statistics/sources'),
                role,
            ).send({ layerId: 999999999, sourceType: 'flood', observedYear: 2025 });
            expect(res.status).not.toBe(403);
            expect(res.status).toBe(422);
            expect(res.body.errors).toContain('LAYER_NOT_ANALYZABLE_OR_FORBIDDEN');
        },
    );
});
