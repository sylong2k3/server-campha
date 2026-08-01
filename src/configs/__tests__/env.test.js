'use strict';

const { validateEnv, applyEnv, EnvValidationError } = require('../env');

const validEnv = (overrides = {}) => ({
    NODE_ENV: 'development',
    HOST: '127.0.0.1',
    PORT: '3006',
    APP_LANG: 'vi',
    TZ: 'Asia/Ho_Chi_Minh',
    APP_NAME: 'WebGIS Cẩm Phả',
    APP_URL: 'http://localhost:3006',
    FRONTEND_URL: 'http://localhost:5173',
    CORS_ORIGINS: 'http://localhost:5173',
    DB_HOST: '127.0.0.1',
    DB_PORT: '5432',
    DB_NAME: 'campha',
    DB_USER: 'campha_app',
    DB_PASSWORD: 'database-password',
    DB_POOL_MIN: '2',
    DB_POOL_MAX: '25',
    JWT_SECRET: 'a'.repeat(48),
    JWT_SECRET_REFRESH: 'b'.repeat(48),
    LAYER_WORK_DIR: 'C:/campha/.runtime/layer-worker',
    LDAP_ENABLED: 'false',
    MFA_ENABLED: 'false',
    PUSH_ENABLED: 'false',
    LAYER_WORKER_ENABLED: 'false',
    STORAGE_ENABLED: 'false',
    CLAMAV_ENABLED: 'false',
    GEOSERVER_ENABLED: 'false',
    ...overrides,
});

describe('environment configuration', () => {
    test('validates and applies normalized defaults', () => {
        const value = validateEnv(validEnv(), { checkFiles: false });
        const target = {};
        applyEnv(value, target);
        expect(target.PORT).toBe('3006');
        expect(target.UPLOAD_IMAGE_MAX_MB).toBe('5');
        expect(target.WS_MAX_PAYLOAD_BYTES).toBe('65536');
    });

    test('rejects invalid ranges and cross-field values', () => {
        expect(() => validateEnv(validEnv({
            DB_POOL_MIN: '30',
            DB_POOL_MAX: '10',
            WEATHER_WIND_GRID_SIZE: '17',
            WEATHER_WIND_GRID_MAX: '16',
        }), { checkFiles: false })).toThrow(/DB_POOL_MIN cannot exceed|WEATHER_WIND_GRID_SIZE/);
    });

    test('requires feature dependencies', () => {
        expect(() => validateEnv(validEnv({ STORAGE_ENABLED: 'true' }), { checkFiles: false }))
            .toThrow(/MINIO_ENDPOINT is required when STORAGE_ENABLED=true/);
        expect(() => validateEnv(validEnv({ PUSH_ENABLED: 'true' }), { checkFiles: false }))
            .toThrow(/requires Firebase credentials/);
    });

    test('rejects unsafe production origins and loopback URLs', () => {
        expect(() => validateEnv(validEnv({
            NODE_ENV: 'production',
            CORS_ORIGINS: '*',
        }), { checkFiles: false })).toThrow(/CORS_ORIGINS cannot contain \*/);
        expect(() => validateEnv(validEnv({
            NODE_ENV: 'production',
            CORS_ORIGINS: 'http://localhost:5173',
        }), { checkFiles: false })).toThrow(/cannot use a loopback host in production/);
    });

    test('redacts secret values from validation errors', () => {
        const secret = 'do-not-print-this-password';
        let caught;
        try {
            validateEnv(validEnv({ DB_PASSWORD: secret, JWT_SECRET: secret }), { checkFiles: false });
        } catch (error) {
            caught = error;
        }
        expect(caught).toBeInstanceOf(EnvValidationError);
        expect(caught.message).not.toContain(secret);
        expect(caught.message).toContain('[REDACTED]');
    });
});
