'use strict';

const { minioBucketProxy, BUCKET_PREFIX_PATTERN } = require('../minio-proxy.middleware');

describe('minioBucketProxy middleware', () => {
    test('matches valid bucket paths and skips non-bucket paths', () => {
        expect(BUCKET_PREFIX_PATTERN.test('/campha-documents/2026/08/doc.pdf')).toBe(true);
        expect(BUCKET_PREFIX_PATTERN.test('/campha-layers/layer1')).toBe(true);
        expect(BUCKET_PREFIX_PATTERN.test('/campha-raster/raster1')).toBe(true);
        expect(BUCKET_PREFIX_PATTERN.test('/campha-field-photos/photo.png')).toBe(true);
        expect(BUCKET_PREFIX_PATTERN.test('/campha-quarantine/temp')).toBe(true);

        expect(BUCKET_PREFIX_PATTERN.test('/api/v1/storage')).toBe(false);
        expect(BUCKET_PREFIX_PATTERN.test('/health')).toBe(false);
    });

    test('calls next() for non-bucket requests', () => {
        const req = { originalUrl: '/api/v1/users' };
        const res = {};
        const next = jest.fn();

        minioBucketProxy(req, res, next);
        expect(next).toHaveBeenCalledTimes(1);
    });
});
