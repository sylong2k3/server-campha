'use strict';

jest.mock('http');
jest.mock('https');
jest.mock('../../configs/minioClient', () => ({ getConfig: jest.fn() }));

const { EventEmitter } = require('events');
const { PassThrough } = require('stream');
const http = require('http');
const https = require('https');
const { getConfig } = require('../../configs/minioClient');
const { minioBucketProxy, configuredBucket, signedRequest } = require('../minio-proxy.middleware');

const config = {
    endPoint: 'minio.internal',
    port: 9000,
    useSSL: false,
    buckets: {
        documents: 'private-documents',
        'flood-rasters': 'custom-flood-rasters',
    },
    quarantineBucket: 'private-quarantine',
};

const request = (url, method = 'GET') => {
    const req = new PassThrough();
    req.originalUrl = url;
    req.path = new URL(url, 'http://localhost').pathname;
    req.method = method;
    req.headers = { host: 'api.example' };
    req.query = Object.fromEntries(new URL(url, 'http://localhost').searchParams);
    return req;
};

const response = () => {
    const res = new PassThrough();
    res.headersSent = false;
    res.status = jest.fn(() => res);
    res.json = jest.fn(() => res);
    res.writeHead = jest.fn(() => {
        res.headersSent = true;
    });
    return res;
};

const upstreamRequest = () => {
    const upstream = new EventEmitter();
    upstream.destroyed = false;
    upstream.end = jest.fn();
    upstream.destroy = jest.fn(() => {
        upstream.destroyed = true;
    });
    return upstream;
};

describe('minioBucketProxy middleware', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        getConfig.mockReturnValue(config);
    });

    test('matches configured primary, optional flood and quarantine buckets only', () => {
        expect(configuredBucket('/private-documents/a.pdf').bucket).toBe('private-documents');
        expect(configuredBucket('/custom-flood-rasters/a.tif').bucket).toBe('custom-flood-rasters');
        expect(configuredBucket('/private-quarantine/a.tmp').bucket).toBe('private-quarantine');
        expect(configuredBucket('/campha-documents/a.pdf')).toBeNull();
    });

    test('requires SigV4 signature and allows only GET, HEAD or PUT', () => {
        expect(signedRequest(request('/private-documents/a.pdf?X-Amz-Signature=abc'))).toBe(true);
        expect(signedRequest(request('/private-documents/a.pdf'))).toBe(false);
        for (const [url, method] of [
            ['/private-documents/a.pdf', 'GET'],
            ['/private-documents/a.pdf?X-Amz-Signature=abc', 'DELETE'],
            ['/not-a-bucket/a.pdf?X-Amz-Signature=abc', 'GET'],
        ]) {
            const next = jest.fn();
            minioBucketProxy(request(url, method), response(), next);
            expect(next).toHaveBeenCalledTimes(1);
        }
    });

    test('uses configured HTTP endpoint, preserves internal Host and redacts signed query from logs', () => {
        const upstream = upstreamRequest();
        http.request.mockReturnValue(upstream);
        const req = request('/private-documents/a.pdf?X-Amz-Signature=secret');
        minioBucketProxy(req, response(), jest.fn());
        expect(http.request).toHaveBeenCalledWith(
            expect.objectContaining({
                hostname: 'minio.internal',
                port: 9000,
                path: req.originalUrl,
                method: 'GET',
                headers: expect.objectContaining({ host: 'minio.internal:9000' }),
                timeout: 120000,
            }),
            expect.any(Function),
        );
        expect(upstream.end).toHaveBeenCalled();
    });

    test('uses HTTPS when MinIO SSL is enabled', () => {
        getConfig.mockReturnValue({ ...config, useSSL: true });
        const upstream = upstreamRequest();
        https.request.mockReturnValue(upstream);
        minioBucketProxy(
            request('/private-documents/a.pdf?X-Amz-Signature=abc'),
            response(),
            jest.fn(),
        );
        expect(https.request).toHaveBeenCalled();
    });

    test('destroys upstream on timeout and when client aborts', () => {
        const upstream = upstreamRequest();
        http.request.mockReturnValue(upstream);
        const req = request('/private-documents/a.pdf?X-Amz-Signature=abc');
        minioBucketProxy(req, response(), jest.fn());
        upstream.emit('timeout');
        expect(upstream.destroy).toHaveBeenCalledWith(expect.any(Error));

        upstream.destroyed = false;
        req.emit('aborted');
        expect(upstream.destroy).toHaveBeenCalledTimes(2);
    });

    test('returns 502 when upstream connection fails before headers', () => {
        const upstream = upstreamRequest();
        http.request.mockReturnValue(upstream);
        const res = response();
        const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
        try {
            minioBucketProxy(
                request('/private-documents/a.pdf?X-Amz-Signature=secret'),
                res,
                jest.fn(),
            );
            upstream.emit('error', new Error('connect refused'));
            expect(res.status).toHaveBeenCalledWith(502);
            expect(res.json).toHaveBeenCalledWith(
                expect.objectContaining({ errors: ['MINIO_PROXY_ERROR'] }),
            );
            expect(errorSpy).toHaveBeenCalledWith(expect.not.stringContaining('X-Amz-Signature'));
        } finally {
            errorSpy.mockRestore();
        }
    });
});
