'use strict';

const ORIGINAL_ENV = process.env;
const load = (env = {}) => {
    jest.resetModules();
    process.env = {
        ...ORIGINAL_ENV,
        STORAGE_ENABLED: 'true',
        MINIO_ENDPOINT: '127.0.0.1',
        MINIO_PORT: '9000',
        MINIO_USE_SSL: 'false',
        MINIO_ACCESS_KEY_FILE: 'access',
        MINIO_SECRET_KEY_FILE: 'secret',
        MINIO_BUCKET_LAYERS: 'campha-layers',
        MINIO_BUCKET_RASTER: 'campha-raster',
        MINIO_BUCKET_DOCUMENTS: 'campha-documents',
        MINIO_BUCKET_FIELD_PHOTOS: 'campha-field-photos',
        MINIO_BUCKET_QUARANTINE: 'campha-quarantine',
        ...env,
    };
    jest.doMock('fs', () => {
        const actual = jest.requireActual('fs');
        return {
            ...actual,
            readFileSync: jest.fn((file, ...args) =>
                file === 'access'
                    ? 'key'
                    : file === 'secret'
                      ? 'secret'
                      : actual.readFileSync(file, ...args),
            ),
        };
    });
    return require('../minioClient');
};
describe('MinIO configuration', () => {
    beforeEach(() => {
        process.env = ORIGINAL_ENV;
        jest.clearAllMocks();
        jest.unmock('fs');
    });
    test('requires an endpoint without URL components', () => {
        expect(() => load({ MINIO_ENDPOINT: 'http://127.0.0.1' }).getConfig()).toThrow(
            'hostname or IP',
        );
    });
    test('requires unique category and quarantine buckets', () => {
        expect(() => load({ MINIO_BUCKET_QUARANTINE: 'campha-layers' }).getConfig()).toThrow(
            'unique',
        );
    });
    test('reads credentials from files and maps categories', () => {
        const config = load().getConfig();
        expect(config).toMatchObject({
            accessKey: 'key',
            secretKey: 'secret',
            buckets: { layers: 'campha-layers' },
            quarantineBucket: 'campha-quarantine',
        });
    });
});
