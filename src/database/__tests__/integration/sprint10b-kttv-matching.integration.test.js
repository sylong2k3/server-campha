'use strict';

if (process.env.DB_NAME !== 'campha_test') {
    throw new Error('Sprint 10b KTTV integration only runs on campha_test');
}

jest.mock('../../../middlewares/auth.middleware', () => {
    const { Api401Error } = require('../../../core/error.response');
    const user = (req) => {
        const role = req.get('x-test-role');
        const permissions = req.get('x-test-permissions');
        const id = Number(req.get('x-test-user-id'));
        return role && permissions && id
            ? { id, role, org_id: 1, role_permissions: JSON.parse(permissions) }
            : null;
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

jest.mock('../../../utils/ssrf-safe-fetch.util', () => ({ fetchSafely: jest.fn() }));

const request = require('supertest');
const db = require('../../../configs/database');
const app = require('../../../app');
const { fetchSafely } = require('../../../utils/ssrf-safe-fetch.util');
const PREFIX = 'IT_S10B_';
const stationCode = 'it_s10b_station';
let rolePermissions;
let testUserId;
let sourceId;

const authAs = (req, role) =>
    req
        .set('x-test-role', role)
        .set('x-test-user-id', String(testUserId))
        .set('x-test-permissions', JSON.stringify(rolePermissions.get(role)));
const cleanup = async () => {
    await db.query(
        `DELETE FROM kttv.observations WHERE input_batch_id IN
         (SELECT id FROM kttv.input_batches WHERE station_code=$1)`,
        [stationCode],
    );
    await db.query(`DELETE FROM kttv.input_batches WHERE station_code=$1`, [stationCode]);
    await db.query(`DELETE FROM kttv.sources WHERE name='it_s10b_source'`);
    sourceId = null;
    await db.query(`DELETE FROM hydro.scenarios WHERE code LIKE $1`, [`${PREFIX}%`]);
    await db.query(`DELETE FROM kttv.stations WHERE code=$1`, [stationCode]);
};
const createScenario = async (code, threshold = 30) =>
    authAs(request(app).post('/api/v1/admin/kttv/scenarios'), 'so_tnmt').send({
        code,
        name: `Scenario ${code}`,
        matchPriority: 10,
        matchRule: {
            all: [{ variable: 'rain_1h_mm', unit: 'mm', op: 'gte', value: threshold }],
        },
    });

describe('Sprint 10b - two modes use shared scenario matcher', () => {
    beforeAll(async () => {
        rolePermissions = new Map();
        for (const role of ['system_admin', 'so_tnmt', 'so_xd', 'ubnd_tp', 'citizen']) {
            const {
                rows: [row],
            } = await db.query('SELECT permissions FROM auth.roles WHERE code=$1', [role]);
            rolePermissions.set(role, row.permissions);
        }
        const {
            rows: [user],
        } = await db.query('SELECT id FROM auth.users ORDER BY id LIMIT 1');
        if (!user) {
            throw new Error('Fixture auth.users required for Sprint 10b');
        }
        testUserId = Number(user.id);
        await cleanup();
        await db.query(
            `INSERT INTO kttv.stations(code,name,station_type,geom)
             VALUES($1,'Integration Sprint 10b','mua',ST_SetSRID(ST_MakePoint(107.3368,21.0089),4326))`,
            [stationCode],
        );
    });
    afterAll(async () => {
        await cleanup();
        db.stopPoolMonitor();
        await db.pool.end();
    });

    test('anonymous/citizen denied; XD cannot publish', async () => {
        await request(app).get('/api/v1/admin/kttv/scenarios').expect(401);
        await authAs(request(app).post('/api/v1/admin/kttv/inputs/manual'), 'citizen')
            .send({
                stationCode,
                observedAt: '2026-08-07T08:00:00Z',
                values: { rain_1h_mm: { value: 1, unit: 'mm' } },
            })
            .expect(403);
        const draft = await createScenario(`${PREFIX}RBAC`);
        expect(draft.status).toBe(201);
        await authAs(
            request(app).post(`/api/v1/admin/kttv/scenarios/${draft.body.data.id}/publish`),
            'so_xd',
        )
            .send({ expectedUpdatedAt: draft.body.data.updated_at })
            .expect(403);
    });

    test('TNMT publishes; manual and automatic inputs share scenario_id', async () => {
        const draft = await createScenario(`${PREFIX}SHARED`);
        const published = await authAs(
            request(app).post(`/api/v1/admin/kttv/scenarios/${draft.body.data.id}/publish`),
            'so_tnmt',
        ).send({ expectedUpdatedAt: draft.body.data.updated_at, isEnabled: true });
        expect(published.status).toBe(200);

        const manual = await authAs(
            request(app).post('/api/v1/admin/kttv/inputs/manual'),
            'system_admin',
        ).send({
            stationCode,
            observedAt: '2026-08-07T09:00:00Z',
            values: { rain_1h_mm: { value: 35, unit: 'mm' } },
        });
        expect(manual.status).toBe(201);
        expect(manual.body.data).toMatchObject({
            input_mode: 'manual',
            match_status: 'matched',
            scenario_id: published.body.data.id,
        });

        const { rows: sources } = await db.query(
            `INSERT INTO kttv.sources(name,service_type,endpoint_url,response_format,variables,is_enabled)
             VALUES('it_s10b_source','REST','https://api.open-meteo.com/v1/forecast','JSON',$1,true)
             RETURNING id`,
            [
                JSON.stringify({
                    observedAtPath: 'current.time',
                    observedAtFormat: 'iso',
                    stationCode,
                    mappings: [
                        {
                            path: 'current.precipitation',
                            variable: 'rain_1h_mm',
                            unit: 'mm',
                            factor: 1,
                            offset: 0,
                            min: 0,
                            max: 500,
                        },
                    ],
                }),
            ],
        );
        sourceId = sources[0].id;
        fetchSafely.mockResolvedValue({
            status: 200,
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                current: { time: '2026-08-07T09:05:00Z', precipitation: 35 },
            }),
        });
        const automatic = await authAs(
            request(app).post(`/api/v1/admin/kttv/sources/${sourceId}/collect`),
            'system_admin',
        );
        expect(automatic.status).toBe(201);
        expect(automatic.body.data).toMatchObject({
            input_mode: 'automatic',
            match_status: 'matched',
            scenario_id: published.body.data.id,
        });

        const manualDetail = await authAs(
            request(app).get(`/api/v1/admin/kttv/inputs/${manual.body.data.id}`),
            'system_admin',
        );
        expect(manualDetail.status).toBe(200);
        expect(manualDetail.body.data.raw_payload).toMatchObject({
            stationCode,
            values: { rain_1h_mm: { value: 35, unit: 'mm' } },
        });
        const automaticDetail = await authAs(
            request(app).get(`/api/v1/admin/kttv/inputs/${automatic.body.data.id}`),
            'system_admin',
        );
        expect(automaticDetail.status).toBe(200);
        expect(automaticDetail.body.data.raw_payload).toEqual({
            current: { time: '2026-08-07T09:05:00Z', precipitation: 35 },
        });

        const { rows } = await db.query(
            `SELECT input_mode,source_id,entered_by,scenario_id FROM kttv.input_batches
             WHERE id=ANY($1::bigint[]) ORDER BY input_mode`,
            [[manual.body.data.id, automatic.body.data.id]],
        );
        expect(rows).toEqual([
            expect.objectContaining({
                input_mode: 'automatic',
                source_id: String(sourceId),
                entered_by: null,
            }),
            expect.objectContaining({
                input_mode: 'manual',
                source_id: null,
                entered_by: String(testUserId),
            }),
        ]);
        const observations = await db.query(
            `SELECT DISTINCT input_mode,unit,quality_flag FROM kttv.observations
             WHERE input_batch_id=ANY($1::bigint[]) ORDER BY input_mode`,
            [[manual.body.data.id, automatic.body.data.id]],
        );
        expect(observations.rows).toEqual([
            { input_mode: 'automatic', unit: 'mm', quality_flag: 'valid' },
            { input_mode: 'manual', unit: 'mm', quality_flag: 'valid' },
        ]);

        const duplicate = await authAs(
            request(app).post(`/api/v1/admin/kttv/sources/${sourceId}/collect`),
            'system_admin',
        );
        expect(duplicate.status).toBe(201);
        expect(duplicate.body.data.id).toBe(automatic.body.data.id);
        const count = await db.query(
            `SELECT COUNT(*)::int count FROM kttv.input_batches
             WHERE source_id=$1 AND station_code=$2 AND observed_at=$3`,
            [sourceId, stationCode, '2026-08-07T09:05:00Z'],
        );
        expect(count.rows[0].count).toBe(1);
    });

    test('no_match input persists without creating scenario', async () => {
        const before = await db.query(`SELECT COUNT(*)::int count FROM hydro.scenarios`);
        const result = await authAs(
            request(app).post('/api/v1/admin/kttv/inputs/manual'),
            'so_xd',
        ).send({
            stationCode,
            observedAt: '2026-08-07T10:00:00Z',
            values: { rain_1h_mm: { value: 1, unit: 'mm' } },
        });
        expect(result.status).toBe(201);
        expect(result.body.data).toMatchObject({ match_status: 'no_match', scenario_id: null });
        const after = await db.query(`SELECT COUNT(*)::int count FROM hydro.scenarios`);
        expect(after.rows[0].count).toBe(before.rows[0].count);
    });

    test('cùng priority trả ambiguous và không tạo scenario mới', async () => {
        const draftA = await createScenario(`${PREFIX}AMB_A`, 20);
        const draftB = await createScenario(`${PREFIX}AMB_B`, 20);
        for (const draft of [draftA, draftB]) {
            const published = await authAs(
                request(app).post(`/api/v1/admin/kttv/scenarios/${draft.body.data.id}/publish`),
                'so_tnmt',
            ).send({ expectedUpdatedAt: draft.body.data.updated_at, isEnabled: true });
            expect(published.status).toBe(200);
        }
        const before = await db.query(`SELECT COUNT(*)::int count FROM hydro.scenarios`);
        const result = await authAs(
            request(app).post('/api/v1/admin/kttv/inputs/manual'),
            'system_admin',
        ).send({
            stationCode,
            observedAt: '2026-08-07T11:00:00Z',
            values: { rain_1h_mm: { value: 25, unit: 'mm' } },
        });
        expect(result.status).toBe(201);
        expect(result.body.data.match_status).toBe('ambiguous');
        expect(result.body.data.scenario_id).toBeNull();
        expect(result.body.data.candidate_scenario_ids).toHaveLength(2);
        const after = await db.query(`SELECT COUNT(*)::int count FROM hydro.scenarios`);
        expect(after.rows[0].count).toBe(before.rows[0].count);
    });

    test('publish stale hoặc publish lại cùng draft trả 409', async () => {
        const draft = await createScenario(`${PREFIX}LOCK`);
        const stale = await authAs(
            request(app).post(`/api/v1/admin/kttv/scenarios/${draft.body.data.id}/publish`),
            'so_tnmt',
        ).send({ expectedUpdatedAt: '2020-01-01T00:00:00Z', isEnabled: true });
        expect(stale.status).toBe(409);
        expect(stale.body.errors).toContain('OPTIMISTIC_LOCK_CONFLICT');

        const published = await authAs(
            request(app).post(`/api/v1/admin/kttv/scenarios/${draft.body.data.id}/publish`),
            'so_tnmt',
        ).send({ expectedUpdatedAt: draft.body.data.updated_at, isEnabled: true });
        expect(published.status).toBe(200);
        const again = await authAs(
            request(app).post(`/api/v1/admin/kttv/scenarios/${draft.body.data.id}/publish`),
            'so_tnmt',
        ).send({ expectedUpdatedAt: published.body.data.updated_at, isEnabled: true });
        expect(again.status).toBe(409);
        expect(again.body.errors).toContain('SCENARIO_NOT_DRAFT');
    });
});
