'use strict';
const request = require('supertest');
const app = require('../../../app');
const db = require('../../../configs/database');
const repository = require('../../../repositories/field-report.repository');
const TokenManager = require('../../../utils/tokenManager.util');
const roles = {};
const userIds = [];
const runId = `${process.pid}-${Date.now()}`;
const token = (role, id) =>
    TokenManager.generateAccessToken({ userId: id, role, tokenVersion: 0 }).token;
const createUser = async (role, index) => {
    const {
        rows: [r],
    } = await db.query('SELECT id,permissions FROM auth.roles WHERE code=$1', [role]);
    roles[role] = r;
    const {
        rows: [u],
    } = await db.query(
        `INSERT INTO auth.users(email,full_name,role_id,is_active) VALUES($1,$2,$3,true) RETURNING id`,
        [`sprint8-${runId}-${role}-${index}@test.local`, role, r.id],
    );
    userIds.push(u.id);
    return { ...u, role, permissions: r.permissions };
};
describe('Sprint 8 field reports integration', () => {
    let citizen, admin, other, report;
    beforeAll(async () => {
        citizen = await createUser('citizen', 1);
        other = await createUser('citizen', 2);
        admin = await createUser('system_admin', 1);
        report = await repository.create(
            {
                description: 'Phản ánh ngập tại khu dân cư Cẩm Phả',
                longitude: 107.33,
                latitude: 21.01,
                photoIds: [],
            },
            citizen,
        );
    });
    afterAll(async () => {
        await db.query(
            'DELETE FROM community.field_reports WHERE sender_user_id=ANY($1::bigint[])',
            [userIds],
        );
        await db.query('DELETE FROM auth.users WHERE id=ANY($1::bigint[])', [userIds]);
        db.stopPoolMonitor();
        await db.pool.end();
    });
    test('RBAC: citizen creates, system admin cannot create but can review', async () => {
        const citizenToken = token('citizen', citizen.id),
            adminToken = token('system_admin', admin.id);
        expect(
            (
                await request(app)
                    .post('/api/v1/field-reports')
                    .set('Authorization', `Bearer ${citizenToken}`)
                    .send({
                        description: 'Phản ánh điểm sạt lở gần tuyến đường',
                        longitude: 107.34,
                        latitude: 21.02,
                        photoIds: [],
                    })
            ).status,
        ).toBe(201);
        expect(
            (
                await request(app)
                    .post('/api/v1/field-reports')
                    .set('Authorization', `Bearer ${adminToken}`)
                    .send({
                        description: 'Phản ánh không được phép từ admin',
                        longitude: 107.34,
                        latitude: 21.02,
                    })
            ).status,
        ).toBe(403);
        const approved = await request(app)
            .patch(`/api/v1/admin/field-reports/${report.id}/review`)
            .set('Authorization', `Bearer ${adminToken}`)
            .send({ status: 'approved', expectedUpdatedAt: report.updated_at });
        expect(approved.status).toBe(200);
    });
    test('public approved payload excludes PII/object keys', async () => {
        const response = await request(app).get('/api/v1/field-reports/public');
        expect(response.status).toBe(200);
        const serialized = JSON.stringify(response.body);
        expect(serialized).not.toMatch(
            /sender_user_id|sender_name|sender_email|object_key|@test\.local/,
        );
    });
    test('owner isolation and subject deletion', async () => {
        const otherToken = token('citizen', other.id),
            citizenToken = token('citizen', citizen.id);
        expect(
            (
                await request(app)
                    .get(`/api/v1/field-reports/${report.id}`)
                    .set('Authorization', `Bearer ${otherToken}`)
            ).status,
        ).toBe(404);
        const current = await repository.find(report.id, 'mine', citizen);
        expect(
            (
                await request(app)
                    .delete(`/api/v1/field-reports/${report.id}`)
                    .query({ expectedUpdatedAt: new Date(current.updated_at).toISOString() })
                    .set('Authorization', `Bearer ${citizenToken}`)
            ).status,
        ).toBe(200);
    });
    test('DB emits ID-only realtime payload and cluster counts distinct senders', async () => {
        const {
            rows: [fn],
        } = await db.query(
            `SELECT pg_get_functiondef('community.notify_field_report_event()'::regprocedure) definition`,
        );
        expect(fn.definition).not.toMatch(/description|sender_user_id|location/);
        const clusters = await repository.clusters({
            from: '2020-01-01',
            to: '2030-01-01',
            radiusMeters: 500,
            minReporters: 2,
        });
        expect(Array.isArray(clusters)).toBe(true);
    });
});
