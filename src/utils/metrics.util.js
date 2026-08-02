'use strict';
const db = require('../configs/database');
const buckets = [0.05, 0.1, 0.25, 0.5, 0.8, 1, 2, 5];
const requests = new Map();
const duration = new Map();
const routeLabel = (req) => {
    const template = req.route?.path;
    if (!template) {
        return 'unmatched';
    }
    const source = `${req.baseUrl || ''}${template}`;
    return source.length > 160 ? source.slice(0, 160) : source;
};
const label = (value) =>
    String(value).replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('\n', '\\n');
const observe = (method, route, status, seconds) => {
    const key = JSON.stringify([method, route, `${Math.floor(status / 100)}xx`]);
    requests.set(key, (requests.get(key) || 0) + 1);
    const current = duration.get(key) || { count: 0, sum: 0, buckets: buckets.map(() => 0) };
    current.count += 1;
    current.sum += seconds;
    buckets.forEach((upper, index) => {
        if (seconds <= upper) {
            current.buckets[index] += 1;
        }
    });
    duration.set(key, current);
};
const middleware = (req, res, next) => {
    const start = process.hrtime.bigint();
    res.once('finish', () =>
        observe(
            req.method,
            routeLabel(req),
            res.statusCode,
            Number(process.hrtime.bigint() - start) / 1e9,
        ),
    );
    next();
};
const jobMetrics = async () => {
    const { rows } = await db.query(`SELECT kind,status,COUNT(*)::int value FROM (
        SELECT 'import' kind,status FROM gis.layer_import_jobs WHERE status IN('queued','running','failed')
        UNION ALL SELECT 'cleanup',status FROM gis.layer_cleanup_jobs WHERE status IN('queued','running','failed')
    ) jobs GROUP BY kind,status`);
    return rows;
};
const render = async () => {
    const lines = [
        '# HELP campha_http_requests_total HTTP requests processed.',
        '# TYPE campha_http_requests_total counter',
    ];
    for (const [key, value] of requests) {
        const [method, route, status] = JSON.parse(key);
        lines.push(
            `campha_http_requests_total{method="${label(method)}",route="${label(route)}",status_class="${status}"} ${value}`,
        );
    }
    lines.push(
        '# HELP campha_http_request_duration_seconds HTTP request duration.',
        '# TYPE campha_http_request_duration_seconds histogram',
    );
    for (const [key, value] of duration) {
        const [method, route, status] = JSON.parse(key);
        const labels = `method="${label(method)}",route="${label(route)}",status_class="${status}"`;
        value.buckets.forEach((count, index) =>
            lines.push(
                `campha_http_request_duration_seconds_bucket{${labels},le="${buckets[index]}"} ${count}`,
            ),
        );
        lines.push(
            `campha_http_request_duration_seconds_bucket{${labels},le="+Inf"} ${value.count}`,
        );
        lines.push(`campha_http_request_duration_seconds_sum{${labels}} ${value.sum}`);
        lines.push(`campha_http_request_duration_seconds_count{${labels}} ${value.count}`);
    }
    lines.push(
        '# HELP campha_db_pool_connections PostgreSQL pool connections.',
        '# TYPE campha_db_pool_connections gauge',
    );
    lines.push(`campha_db_pool_connections{state="total"} ${db.pool.totalCount}`);
    lines.push(`campha_db_pool_connections{state="idle"} ${db.pool.idleCount}`);
    lines.push(`campha_db_pool_connections{state="waiting"} ${db.pool.waitingCount}`);
    lines.push(
        '# HELP campha_layer_jobs Layer import and cleanup jobs.',
        '# TYPE campha_layer_jobs gauge',
    );
    for (const row of await jobMetrics()) {
        lines.push(`campha_layer_jobs{kind="${row.kind}",status="${row.status}"} ${row.value}`);
    }
    return `${lines.join('\n')}\n`;
};
const reset = () => {
    requests.clear();
    duration.clear();
};
module.exports = { middleware, observe, render, reset };
