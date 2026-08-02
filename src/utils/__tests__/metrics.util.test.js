'use strict';
process.env.METRICS_ENABLED = 'true';
process.env.METRICS_TOKEN = 'm'.repeat(48);
const request = require('supertest');
const db = require('../../configs/database');
const metrics = require('../metrics.util');
const app = require('../../app');
afterAll(async () => {
    metrics.reset();
    db.stopPoolMonitor();
    await db.pool.end();
});
test('metrics endpoint is disabled by default, then requires bearer and exposes bounded metrics', async () => {
    process.env.METRICS_ENABLED = 'false';
    await request(app).get('/metrics').expect(404);
    process.env.METRICS_ENABLED = 'true';
    await request(app).get('/health').expect(200);
    await request(app).get('/metrics').expect(401);
    const response = await request(app)
        .get('/metrics')
        .set('authorization', `Bearer ${process.env.METRICS_TOKEN}`)
        .expect(200);
    expect(response.headers['content-type']).toContain('text/plain');
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.text).toContain('campha_http_requests_total');
    expect(response.text).toContain('route="/health"');
    expect(response.text).not.toMatch(/route="[^"]*\/\d+/);
    expect(response.text).toContain('campha_db_pool_connections');
    expect(response.text).toContain('campha_layer_jobs');
    expect(response.text).not.toContain(process.env.METRICS_TOKEN);
});
