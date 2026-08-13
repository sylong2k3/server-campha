'use strict';

process.env.JWT_SECRET ||= 'test-download-ticket-secret-at-least-32-characters';

jest.mock('../../configs/minioClient', () => ({
    getClient: jest.fn(),
    getBucketForCategory: jest.fn(() => 'campha-documents'),
    getQuarantineBucket: jest.fn(() => 'campha-quarantine'),
}));

const jwt = require('jsonwebtoken');
const minioService = require('../minio.service');

const originalBaseUrl = process.env.API_BASE_URL;

describe('minio download ticket URL', () => {
    afterAll(() => {
        process.env.API_BASE_URL = originalBaseUrl;
    });

    test('builds a stable API URL for public managed files', () => {
        process.env.API_BASE_URL = 'http://127.0.0.1:3006/api/v1/';
        expect(minioService.getPublicFileUrl(56)).toEqual({
            url: 'http://127.0.0.1:3006/api/v1/storage/objects/56/file',
            expiresAt: null,
        });
        expect(() => minioService.getPublicFileUrl(0)).toThrow('positive integer');
    });

    test.each([
        ['http://127.0.0.1:3006', 'http://127.0.0.1:3006/api/v1/storage/objects/56/file'],
        ['http://127.0.0.1:3006/', 'http://127.0.0.1:3006/api/v1/storage/objects/56/file'],
        ['http://127.0.0.1:3006/api/v1', 'http://127.0.0.1:3006/api/v1/storage/objects/56/file'],
        ['http://127.0.0.1:3006/api/v1/', 'http://127.0.0.1:3006/api/v1/storage/objects/56/file'],
    ])('normalizes API_BASE_URL %s', async (baseUrl, expectedPath) => {
        process.env.API_BASE_URL = baseUrl;
        const result = await minioService.getPresignedDownloadUrl({
            objectKey: 'documents/report.pdf',
            category: 'documents',
            expireSeconds: 300,
            fileId: 56,
        });
        const url = new URL(result.url);
        expect(`${url.origin}${url.pathname}`).toBe(expectedPath);
        expect(jwt.verify(url.searchParams.get('ticket'), process.env.JWT_SECRET)).toMatchObject({
            fileObjectId: 56,
            purpose: 'file_download',
        });
    });

    test.each([59, 3601, 1.5])(
        'rejects expiry outside allowed integer range: %s',
        async (value) => {
            await expect(
                minioService.getPresignedDownloadUrl({
                    objectKey: 'documents/report.pdf',
                    category: 'documents',
                    expireSeconds: value,
                    fileId: 56,
                }),
            ).rejects.toThrow('Presigned expiry must be 60-3600 seconds');
        },
    );
});
