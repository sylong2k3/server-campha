'use strict';

const http = require('http');
const https = require('https');
const { getConfig } = require('../configs/minioClient');

const DEFAULT_TIMEOUT_MS = 120000;
const SAFE_METHODS = new Set(['GET', 'HEAD', 'PUT']);

const signedRequest = (req) => {
    const query =
        req.query || Object.fromEntries(new URL(req.originalUrl, 'http://localhost').searchParams);
    return Boolean(query['X-Amz-Signature'] || query['x-amz-signature']);
};

const configuredBucket = (pathname) => {
    const config = getConfig();
    if (!config) {
        return null;
    }
    const bucket = decodeURIComponent(pathname.split('/')[1] || '');
    const allowed = new Set([...Object.values(config.buckets), config.quarantineBucket]);
    return allowed.has(bucket) ? { bucket, config } : null;
};

/**
 * Streams configured MinIO bucket URLs through the API host. SigV4 signs Host,
 * so upstream Host must remain the internal MinIO endpoint even when the public
 * origin was replaced by MINIO_PUBLIC_URL.
 */
function minioBucketProxy(req, res, next) {
    let target;
    try {
        target = configuredBucket(
            req.path || new URL(req.originalUrl, 'http://localhost').pathname,
        );
    } catch (error) {
        return next(error);
    }
    if (!target || !SAFE_METHODS.has(req.method) || !signedRequest(req)) {
        return next();
    }

    const { config } = target;
    const transport = config.useSSL ? https : http;
    const timeout = Number(process.env.MINIO_PROXY_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS;
    const headers = { ...req.headers, host: `${config.endPoint}:${config.port}` };

    const upstream = transport.request(
        {
            hostname: config.endPoint,
            port: config.port,
            path: req.originalUrl,
            method: req.method,
            headers,
            timeout,
        },
        (upstreamResponse) => {
            res.writeHead(upstreamResponse.statusCode, upstreamResponse.headers);
            upstreamResponse.pipe(res);
        },
    );

    const abortUpstream = () => {
        if (!upstream.destroyed) {
            upstream.destroy();
        }
    };
    req.once('aborted', abortUpstream);
    res.once('close', () => {
        if (!res.writableEnded) {
            abortUpstream();
        }
    });

    upstream.once('timeout', () => upstream.destroy(new Error('MinIO proxy timeout')));
    upstream.once('error', (error) => {
        console.error(`[MINIO-PROXY] ${req.method} ${req.path || '/'}: ${error.message}`);
        if (!res.headersSent) {
            res.status(502).json({
                success: false,
                message: 'Không thể kết nối đến kho dữ liệu MinIO',
                errors: ['MINIO_PROXY_ERROR'],
            });
        } else if (!res.destroyed) {
            res.destroy(error);
        }
    });

    if (req.method === 'PUT') {
        req.pipe(upstream);
    } else {
        upstream.end();
    }
}

module.exports = { minioBucketProxy, configuredBucket, signedRequest };
