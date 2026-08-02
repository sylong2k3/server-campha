'use strict';
if (process.env.DB_NAME !== 'campha_test') {
    throw new Error(
        `Sprint 14 hardening integration chỉ được chạy với DB_NAME=campha_test; received ${process.env.DB_NAME}`,
    );
}
process.env.REQUEST_BODY_LIMIT = '1kb';
const request = require('supertest');
const db = require('../../../configs/database');
const app = require('../../../app');
let consoleError;
beforeAll(() => {
    consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterAll(async () => {
    consoleError.mockRestore();
    db.stopPoolMonitor();
    await db.pool.end();
});
test('responses carry security headers and stable reads support ETag revalidation', async () => {
    const health = await request(app).get('/health').expect(200);
    expect(health.headers['content-security-policy']).toContain("default-src 'self'");
    expect(health.headers['x-content-type-options']).toBe('nosniff');
    const first = await request(app).get('/api/v1/web-map/basemaps').expect(200);
    expect(first.headers.etag).toBeTruthy();
    await request(app)
        .get('/api/v1/web-map/basemaps')
        .set('if-none-match', first.headers.etag)
        .expect(304);
});
test('API cache policy is public for anonymous GET and private for bearer requests', async () => {
    const anonymous = await request(app).get('/api/v1/web-map/basemaps');
    expect(anonymous.headers['cache-control']).toContain('public');
    expect(anonymous.headers.vary).toContain('Authorization');
    expect(anonymous.headers.vary).toContain('Cookie');
    expect(
        (await request(app).get('/api/v1/web-map/basemaps').set('authorization', 'Bearer invalid'))
            .headers['cache-control'],
    ).toContain('private');
});
test('oversized JSON is rejected without stack disclosure', async () => {
    const response = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: 'a@example.vn', password: 'x'.repeat(2048) })
        .expect(413);
    expect(JSON.stringify(response.body)).not.toMatch(/node_modules|\.js:\d+/);
    expect(response.body.errors).toEqual(['PAYLOAD_TOO_LARGE']);
});
