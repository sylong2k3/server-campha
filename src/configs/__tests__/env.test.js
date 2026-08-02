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
        expect(target.SERVER_REQUEST_TIMEOUT_MS).toBe('30000');
        expect(target.METRICS_ENABLED).toBe('false');
    });

    test('rejects invalid ranges and cross-field values', () => {
        expect(() =>
            validateEnv(
                validEnv({
                    DB_POOL_MIN: '30',
                    DB_POOL_MAX: '10',
                    WEATHER_WIND_GRID_SIZE: '17',
                    WEATHER_WIND_GRID_MAX: '16',
                }),
                { checkFiles: false },
            ),
        ).toThrow(/DB_POOL_MIN cannot exceed|WEATHER_WIND_GRID_SIZE/);
        expect(() =>
            validateEnv(
                validEnv({
                    SERVER_REQUEST_TIMEOUT_MS: '10000',
                    SERVER_HEADERS_TIMEOUT_MS: '11000',
                }),
                { checkFiles: false },
            ),
        ).toThrow(/SERVER_HEADERS_TIMEOUT_MS cannot exceed/);
    });

    test('requires feature dependencies', () => {
        expect(() =>
            validateEnv(validEnv({ STORAGE_ENABLED: 'true' }), { checkFiles: false }),
        ).toThrow(/MINIO_ENDPOINT is required when STORAGE_ENABLED=true/);
        expect(() =>
            validateEnv(validEnv({ PUSH_ENABLED: 'true' }), { checkFiles: false }),
        ).toThrow(/requires Firebase credentials/);
    });

    test('rejects unsafe production origins and loopback URLs', () => {
        expect(() =>
            validateEnv(
                validEnv({
                    NODE_ENV: 'production',
                    API_SHARE_JWT_SECRET: 'c'.repeat(48),
                    CORS_ORIGINS: '*',
                }),
                { checkFiles: false },
            ),
        ).toThrow(/CORS_ORIGINS cannot contain \*/);
        expect(() =>
            validateEnv(
                validEnv({
                    NODE_ENV: 'production',
                    API_SHARE_JWT_SECRET: 'c'.repeat(48),
                    CORS_ORIGINS: 'http://localhost:5173',
                }),
                { checkFiles: false },
            ),
        ).toThrow(/cannot use a loopback host in production/);
    });

    test('requires a distinct share JWT secret in production', () => {
        expect(() =>
            validateEnv(validEnv({ NODE_ENV: 'production' }), { checkFiles: false }),
        ).toThrow(/API_SHARE_JWT_SECRET is required/);
        expect(() =>
            validateEnv(
                validEnv({
                    NODE_ENV: 'production',
                    API_SHARE_JWT_SECRET: 'a'.repeat(48),
                }),
                { checkFiles: false },
            ),
        ).toThrow(/must differ from user JWT secrets/);
    });

    test('requires metrics bearer token only in production', () => {
        const production = {
            NODE_ENV: 'production',
            APP_URL: 'https://api.campha.vn',
            API_BASE_URL: 'https://api.campha.vn',
            FRONTEND_URL: 'https://gis.campha.vn',
            CORS_ORIGINS: 'https://gis.campha.vn',
            API_SHARE_JWT_SECRET: 'c'.repeat(48),
            METRICS_ENABLED: 'true',
        };
        expect(() => validateEnv(validEnv(production), { checkFiles: false })).toThrow(
            /METRICS_TOKEN is required/,
        );
        expect(
            validateEnv(validEnv({ ...production, METRICS_TOKEN: 'm'.repeat(48) }), {
                checkFiles: false,
            }).METRICS_ENABLED,
        ).toBe('true');
    });

    test('redacts secret values from validation errors', () => {
        const secret = 'do-not-print-this-password';
        let caught;
        try {
            // MFA_ENCRYPTION_KEY sai pattern -> Joi in ca gia tri ra message, phai bi che.
            validateEnv(validEnv({ DB_PASSWORD: secret, MFA_ENCRYPTION_KEY: secret }), {
                checkFiles: false,
            });
        } catch (error) {
            caught = error;
        }
        expect(caught).toBeInstanceOf(EnvValidationError);
        expect(caught.message).not.toContain(secret);
        expect(caught.message).toContain('[REDACTED]');
    });
});
