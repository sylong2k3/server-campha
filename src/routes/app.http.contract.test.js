'use strict';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'route-test-secret-must-be-at-least-32-characters-long';
process.env.JWT_SECRET_REFRESH = process.env.JWT_SECRET_REFRESH || 'route-refresh-secret-must-be-at-least-32-characters-long';
process.env.HTTP_ACCESS_LOG_ENABLED = 'false';

const request = require('supertest');
const app = require('../app');

describe('Express Server HTTP route contract', () => {
    test('GET /health returns a health response without authentication', async () => {
        const response = await request(app).get('/health');
        expect(response.status).toBe(200);
        expect(response.body).toEqual(expect.objectContaining({ status: 'OK' }));
        expect(typeof response.body.timestamp).toBe('string');
    });

    test('GET / returns the API root envelope', async () => {
        const response = await request(app).get('/');
        expect(response.status).toBe(200);
        expect(response.body).toEqual(expect.objectContaining({ status: 'success', version: '1.0.0' }));
    });

    test('blocks sensitive paths before routers and does not expose traversal content', async () => {
        for (const path of ['/.env', '/.git/config']) {
            const response = await request(app).get(path);
            expect(response.status).toBe(403);
        }
        // Supertest normalizes `/../secret` to `/secret` before it reaches Express;
        // assert that the normalized path is not served rather than expecting the
        // pre-normalization middleware branch to run.
        const traversal = await request(app).get('/../secret');
        expect(traversal.status).toBe(404);
    });

    test('protected Admin route rejects missing authentication', async () => {
        const response = await request(app).get('/api/v1/admin/users');
        expect([401, 403]).toContain(response.status);
    });

    test('unknown API route returns the Server not-found contract', async () => {
        const response = await request(app).get('/api/v1/not-a-real-route');
        expect(response.status).toBe(404);
    });
});
