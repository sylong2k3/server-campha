'use strict';

const http = require('http');

const BUCKET_PREFIX_PATTERN = /^\/campha-(layers|raster|documents|field-photos|quarantine)(\/|$)/i;

/**
 * Proxy MinIO bucket requests (e.g. /campha-documents/*, /campha-layers/*)
 * directly to MinIO server. Fixes presigned URLs returning 404 when routed
 * through the API domain.
 */
function minioBucketProxy(req, res, next) {
    if (!BUCKET_PREFIX_PATTERN.test(req.originalUrl)) {
        return next();
    }

    const targetHost = process.env.MINIO_ENDPOINT || '103.163.119.247';
    const targetPort = Number(process.env.MINIO_PORT) || 9000;

    const headers = { ...req.headers };
    headers.host = `${targetHost}:${targetPort}`;

    const options = {
        hostname: targetHost,
        port: targetPort,
        path: req.originalUrl,
        method: req.method,
        headers,
    };

    const proxyReq = http.request(options, (proxyRes) => {
        res.writeHead(proxyRes.statusCode, proxyRes.headers);
        proxyRes.pipe(res, { end: true });
    });

    proxyReq.on('error', (err) => {
        console.error(`[MINIO-PROXY] Error proxying ${req.method} ${req.originalUrl}:`, err.message);
        if (!res.headersSent) {
            res.status(502).json({
                success: false,
                message: 'Không thể kết nối đến kho dữ liệu MinIO',
                errors: ['MINIO_PROXY_ERROR'],
            });
        }
    });

    if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
        req.pipe(proxyReq, { end: true });
    } else {
        proxyReq.end();
    }
}

module.exports = {
    minioBucketProxy,
    BUCKET_PREFIX_PATTERN,
};
