'use strict';

const fs = require('fs');
const path = require('path');
const Joi = require('joi');
const dotenv = require('dotenv');

const boolean = Joi.string().valid('true', 'false');
const positiveInteger = Joi.number().integer().positive();
const nonNegativeInteger = Joi.number().integer().min(0);
const port = Joi.number().integer().min(1).max(65535);
const httpUrl = Joi.string().uri({ scheme: ['http', 'https'] });
const duration = Joi.string().pattern(/^\d+(?:ms|s|m|h|d|w|y)$/i);

const ENV_SCHEMA_KEYS = {
    NODE_ENV: Joi.string().valid('development', 'test', 'production').default('development'),
    HOST: Joi.string().trim().min(1).default('0.0.0.0'),
    PORT: port.default(3006),
    APP_LANG: Joi.string().valid('vi', 'en').default('vi'),
    TZ: Joi.string().trim().min(1).default('Asia/Ho_Chi_Minh'),
    APP_NAME: Joi.string().trim().min(1).required(),
    APP_URL: httpUrl.required(),
    FRONTEND_URL: httpUrl.required(),
    CORS_ORIGINS: Joi.string().trim().min(1).required(),
    TRUST_PROXY: Joi.string().trim().min(1).default('false'),
    REQUEST_BODY_LIMIT: Joi.string()
        .pattern(/^\d+(?:b|kb|mb|gb)$/i)
        .default('2mb'),
    RATE_LIMIT_MAX: positiveInteger.default(1000),
    HTTP_ACCESS_LOG_ENABLED: boolean.default('true'),
    SERVER_REQUEST_TIMEOUT_MS: positiveInteger.min(1000).max(600000).default(30000),
    SERVER_HEADERS_TIMEOUT_MS: positiveInteger.min(1000).max(120000).default(15000),
    SERVER_KEEP_ALIVE_TIMEOUT_MS: positiveInteger.min(1000).max(120000).default(5000),
    SHUTDOWN_TIMEOUT_MS: positiveInteger.min(1000).max(120000).default(10000),
    METRICS_ENABLED: boolean.default('false'),
    METRICS_TOKEN: Joi.string().min(32).allow(''),
    API_BASE_URL: httpUrl.default('http://127.0.0.1:3006'),

    DB_HOST: Joi.string().trim().min(1).required(),
    DB_PORT: port.default(5432),
    DB_NAME: Joi.string().trim().min(1).required(),
    DB_USER: Joi.string().trim().min(1).required(),
    DB_PASSWORD: Joi.string().min(1).required(),
    DB_POOL_MIN: nonNegativeInteger.default(2),
    DB_POOL_MAX: positiveInteger.default(25),
    DB_CONN_TIMEOUT_MS: positiveInteger.default(10000),
    DB_STATEMENT_TIMEOUT: positiveInteger.default(30000),
    DB_QUERY_TIMEOUT: positiveInteger.default(30000),
    DB_SLOW_QUERY_MS: positiveInteger.default(500),
    DB_POOL_MONITOR_MS: positiveInteger.default(30000),

    JWT_SECRET: Joi.string().min(32).required(),
    JWT_SECRET_REFRESH: Joi.string().min(32).required(),
    API_SHARE_JWT_SECRET: Joi.string().min(32).allow(''),
    JWT_ALGORITHM: Joi.string().valid('HS256', 'HS384', 'HS512').default('HS256'),
    JWT_ACCESS_EXPIRES_IN: duration.default('15m'),
    JWT_REFRESH_EXPIRES_IN: duration.default('30d'),
    REQUIRE_EMAIL_VERIFICATION: boolean.default('true'),
    AUTH_RATE_LIMIT: positiveInteger.default(20),
    RESET_RATE_LIMIT: positiveInteger.default(5),
    RESET_TOKEN_EXPIRES_MINUTES: positiveInteger.default(15),
    RESET_MAX_REQUESTS: positiveInteger.default(3),
    EMAIL_VERIFICATION_EXPIRES_MINUTES: positiveInteger.default(60),
    EMAIL_VERIFICATION_MAX_REQUESTS: positiveInteger.default(3),

    GOOGLE_CLIENT_ID: Joi.string().trim().allow(''),
    GOOGLE_CLIENT_SECRET: Joi.string().allow(''),
    GOOGLE_CALLBACK_URL: httpUrl.allow(''),
    GOOGLE_ANDROID_CLIENT_ID: Joi.string().trim().allow(''),
    GOOGLE_IOS_CLIENT_ID: Joi.string().trim().allow(''),
    OAUTH_CODE_EXPIRES_SECONDS: positiveInteger.default(60),

    SMTP_HOST: Joi.string().trim().allow(''),
    SMTP_PORT: port.default(587),
    SMTP_SECURE: boolean.default('false'),
    SMTP_USER: Joi.string().trim().allow(''),
    SMTP_PASS: Joi.string().allow(''),
    MAIL_FROM: Joi.string().trim().allow(''),

    PUSH_ENABLED: boolean.default('false'),
    FIREBASE_SERVICE_ACCOUNT_BASE64: Joi.string().allow(''),
    FIREBASE_SERVICE_ACCOUNT: Joi.string().trim().allow(''),
    GOOGLE_APPLICATION_CREDENTIALS: Joi.string().trim().allow(''),
    DEVICE_TOKEN_ENCRYPTION_KEY: Joi.string()
        .pattern(/^[a-f0-9]{64}$/i)
        .allow(''),

    LAYER_WORKER_ENABLED: boolean.default('false'),
    LAYER_WORKER_CONCURRENCY: positiveInteger.max(16).default(1),
    LAYER_WORKER_POLL_MS: positiveInteger.min(250).default(1500),
    LAYER_WORKER_LEASE_SECONDS: positiveInteger.min(30).default(120),
    LAYER_WORK_DIR: Joi.string().trim().min(1).required(),
    LAYER_GDAL_TIMEOUT_MS: positiveInteger.default(600000),
    LAYER_DB_TIMEOUT_MS: positiveInteger.default(300000),
    LAYER_IMPORT_ERROR_LIMIT: positiveInteger.default(1000),
    GDAL_OGR2OGR_PATH: Joi.string().trim().allow(''),
    GDAL_OGRINFO_PATH: Joi.string().trim().allow(''),
    PROJ_DATA_PATH: Joi.string().trim().allow(''),
    GDAL_DATA_PATH: Joi.string().trim().allow(''),
    LAYER_ZIP_MAX_ENTRIES: positiveInteger.default(64),
    LAYER_ZIP_MAX_ENTRY_MB: positiveInteger.default(512),
    LAYER_ZIP_MAX_EXPANDED_MB: positiveInteger.default(1024),
    LAYER_ZIP_MAX_COMPRESSION_RATIO: positiveInteger.default(100),

    STORAGE_ENABLED: boolean.default('false'),
    MINIO_ENDPOINT: Joi.string().trim().allow(''),
    MINIO_PORT: port.default(9000),
    MINIO_USE_SSL: boolean.default('false'),
    MINIO_ACCESS_KEY_FILE: Joi.string().trim().allow(''),
    MINIO_SECRET_KEY_FILE: Joi.string().trim().allow(''),
    MINIO_BUCKET_LAYERS: Joi.string().trim().allow(''),
    MINIO_BUCKET_RASTER: Joi.string().trim().allow(''),
    MINIO_BUCKET_DOCUMENTS: Joi.string().trim().allow(''),
    MINIO_BUCKET_FIELD_PHOTOS: Joi.string().trim().allow(''),
    MINIO_BUCKET_QUARANTINE: Joi.string().trim().allow(''),
    MINIO_REGION: Joi.string().trim().default('us-east-1'),
    MINIO_PRESIGNED_EXPIRE_SECONDS: positiveInteger.max(604800).default(900),
    MINIO_UPLOAD_PRESIGNED_EXPIRE_SECONDS: positiveInteger.max(604800).default(900),
    STORAGE_MAX_LAYER_MB: positiveInteger.default(500),
    STORAGE_MAX_RASTER_MB: positiveInteger.default(2048),
    STORAGE_MAX_DOCUMENT_MB: positiveInteger.default(50),
    STORAGE_MAX_FIELD_PHOTO_MB: positiveInteger.default(10),

    CLAMAV_ENABLED: boolean.default('false'),
    CLAMAV_HOST: Joi.string().trim().allow(''),
    CLAMAV_PORT: port.default(3310),
    CLAMAV_TIMEOUT_MS: positiveInteger.min(1000).max(120000).default(30000),

    GEOSERVER_ENABLED: boolean.default('false'),
    GEOSERVER_URL: httpUrl.allow(''),
    GEOSERVER_USER: Joi.string().trim().allow(''),
    GEOSERVER_PASSWORD_FILE: Joi.string().trim().allow(''),
    GEOSERVER_WORKSPACE: Joi.string()
        .pattern(/^[a-z][a-z0-9_-]{0,79}$/)
        .default('campha'),
    GEOSERVER_NAMESPACE_URI: httpUrl.default('https://gis.campha.gov.vn/campha'),
    GEOSERVER_DATASTORE: Joi.string()
        .pattern(/^[a-z][a-z0-9_-]{0,79}$/)
        .default('campha_postgis'),
    GEOSERVER_TIMEOUT_MS: positiveInteger.min(1000).max(120000).default(15000),
    MAP_PROXY_MAX_RESPONSE_MB: positiveInteger.default(25),
    RASTER_INGEST_DEBUG: boolean.default('false'),

    OPENWEATHER_API_KEY: Joi.string().trim().allow(''),
    OPENWEATHER_BASE_URL: httpUrl.default('https://api.openweathermap.org/data/2.5'),
    OPENWEATHER_TILE_URL: httpUrl.default('https://tile.openweathermap.org/map'),
    OPEN_METEO_URL: httpUrl.default('https://api.open-meteo.com/v1/forecast'),
    WEATHER_UNITS: Joi.string().valid('standard', 'metric', 'imperial').default('metric'),
    WEATHER_LANG: Joi.string().trim().min(2).max(10).default('vi'),
    WEATHER_WIND_GRID_SIZE: positiveInteger.default(8),
    WEATHER_WIND_GRID_MAX: positiveInteger.max(64).default(16),
    WEATHER_HTTP_TIMEOUT_MS: positiveInteger.min(1000).max(120000).default(10000),

    UPLOAD_IMAGE_MAX_MB: positiveInteger.default(5),
    UPLOAD_DOCUMENT_MAX_MB: positiveInteger.default(20),
    UPLOAD_MAX_FILES: positiveInteger.max(100).default(20),
    WS_MAX_CHANNELS: positiveInteger.max(1000).default(20),
    WS_MAX_MESSAGES_PER_MINUTE: positiveInteger.max(10000).default(60),
    WS_MAX_PAYLOAD_BYTES: positiveInteger.max(10 * 1024 * 1024).default(65536),
    TOKEN_CLEANUP_CRON: Joi.string().trim().min(1).default('0 * * * *'),
    API_TEST_PASSWORD: Joi.string().allow(''),
};

const envSchema = Joi.object(ENV_SCHEMA_KEYS).unknown(true);
const SECRET_NAME_PATTERN =
    /(PASSWORD|PASS|SECRET|TOKEN|API_KEY|ACCESS_KEY|ENCRYPTION_KEY|SERVICE_ACCOUNT)/i;

class EnvValidationError extends Error {
    constructor(errors) {
        super(`Invalid environment configuration:\n- ${errors.join('\n- ')}`);
        this.name = 'EnvValidationError';
        this.errors = errors;
    }
}

const redactSecrets = (message, source) => {
    let safe = String(message);
    for (const [name, rawValue] of Object.entries(source)) {
        if (
            !SECRET_NAME_PATTERN.test(name) ||
            typeof rawValue !== 'string' ||
            rawValue.length < 4
        ) {
            continue;
        }
        safe = safe.split(rawValue).join('[REDACTED]');
    }
    return safe;
};

const requireNames = (value, enabledName, names, errors) => {
    if (value[enabledName] !== 'true') {
        return;
    }
    for (const name of names) {
        if (!String(value[name] || '').trim()) {
            errors.push(`${name} is required when ${enabledName}=true`);
        }
    }
};

const checkReadableFile = (value, name, errors, checkFiles) => {
    if (!checkFiles || !value[name]) {
        return;
    }
    const file = path.resolve(value[name]);
    try {
        if (!fs.statSync(file).isFile()) {
            errors.push(`${name} must point to a file`);
        } else if (!fs.readFileSync(file, 'utf8').trim()) {
            errors.push(`${name} points to an empty file`);
        }
    } catch {
        errors.push(`${name} points to an unreadable file`);
    }
};

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1', '[::1]']);

const isLoopbackUrl = (url) => {
    try {
        return LOOPBACK_HOSTS.has(new URL(url).hostname.toLowerCase());
    } catch {
        return false;
    }
};

const validateProductionUrls = (value, errors) => {
    if (value.NODE_ENV !== 'production') {
        return;
    }
    for (const name of ['APP_URL', 'FRONTEND_URL', 'API_BASE_URL']) {
        if (isLoopbackUrl(value[name])) {
            errors.push(`${name} cannot use a loopback host in production`);
        }
    }
};

const validateCors = (value, errors) => {
    const origins = value.CORS_ORIGINS.split(',')
        .map((origin) => origin.trim())
        .filter(Boolean);
    if (!origins.length) {
        errors.push('CORS_ORIGINS must contain at least one origin');
        return;
    }
    if (value.NODE_ENV === 'production' && origins.includes('*')) {
        errors.push('CORS_ORIGINS cannot contain * in production');
        return;
    }
    for (const origin of origins) {
        if (origin === '*') {
            continue;
        }
        try {
            const parsed = new URL(origin);
            if (!['http:', 'https:'].includes(parsed.protocol) || parsed.origin !== origin) {
                throw new Error();
            }
        } catch {
            errors.push(`CORS_ORIGINS contains an invalid origin: ${origin}`);
            continue;
        }
        if (value.NODE_ENV === 'production' && isLoopbackUrl(origin)) {
            errors.push(`CORS_ORIGINS cannot use a loopback host in production: ${origin}`);
        }
    }
    if (!origins.includes('*') && !origins.includes(new URL(value.FRONTEND_URL).origin)) {
        errors.push('CORS_ORIGINS must include the FRONTEND_URL origin');
    }
};

const validateEnv = (source = process.env, { checkFiles = true } = {}) => {
    const { value, error } = envSchema.validate(source, {
        abortEarly: false,
        allowUnknown: true,
        convert: true,
    });
    const errors = error ? error.details.map((detail) => detail.message) : [];

    if (!error) {
        if (/^(your_|change[-_]?me)/i.test(value.JWT_SECRET)) {
            errors.push('JWT_SECRET contains a placeholder');
        }
        if (/^(your_|change[-_]?me)/i.test(value.JWT_SECRET_REFRESH)) {
            errors.push('JWT_SECRET_REFRESH contains a placeholder');
        }
        if (
            value.API_SHARE_JWT_SECRET &&
            /^(your_|change[-_]?me)/i.test(value.API_SHARE_JWT_SECRET)
        ) {
            errors.push('API_SHARE_JWT_SECRET contains a placeholder');
        }
        if (value.JWT_SECRET === value.JWT_SECRET_REFRESH) {
            errors.push('JWT_SECRET_REFRESH must differ from JWT_SECRET');
        }
        if (
            value.API_SHARE_JWT_SECRET &&
            [value.JWT_SECRET, value.JWT_SECRET_REFRESH].includes(value.API_SHARE_JWT_SECRET)
        ) {
            errors.push('API_SHARE_JWT_SECRET must differ from user JWT secrets');
        }
        if (value.NODE_ENV === 'production' && !value.API_SHARE_JWT_SECRET) {
            errors.push('API_SHARE_JWT_SECRET is required in production');
        }
        if (value.SERVER_HEADERS_TIMEOUT_MS > value.SERVER_REQUEST_TIMEOUT_MS) {
            errors.push('SERVER_HEADERS_TIMEOUT_MS cannot exceed SERVER_REQUEST_TIMEOUT_MS');
        }
        if (
            value.METRICS_ENABLED === 'true' &&
            value.NODE_ENV === 'production' &&
            !value.METRICS_TOKEN
        ) {
            errors.push('METRICS_TOKEN is required when METRICS_ENABLED=true in production');
        }
        if (value.DB_POOL_MIN > value.DB_POOL_MAX) {
            errors.push('DB_POOL_MIN cannot exceed DB_POOL_MAX');
        }
        if (value.WEATHER_WIND_GRID_SIZE > value.WEATHER_WIND_GRID_MAX) {
            errors.push('WEATHER_WIND_GRID_SIZE cannot exceed WEATHER_WIND_GRID_MAX');
        }

        validateProductionUrls(value, errors);
        validateCors(value, errors);
        requireNames(
            value,
            'STORAGE_ENABLED',
            [
                'MINIO_ENDPOINT',
                'MINIO_ACCESS_KEY_FILE',
                'MINIO_SECRET_KEY_FILE',
                'MINIO_BUCKET_LAYERS',
                'MINIO_BUCKET_RASTER',
                'MINIO_BUCKET_DOCUMENTS',
                'MINIO_BUCKET_FIELD_PHOTOS',
                'MINIO_BUCKET_QUARANTINE',
            ],
            errors,
        );
        requireNames(value, 'CLAMAV_ENABLED', ['CLAMAV_HOST'], errors);
        requireNames(
            value,
            'GEOSERVER_ENABLED',
            ['GEOSERVER_URL', 'GEOSERVER_USER', 'GEOSERVER_PASSWORD_FILE'],
            errors,
        );
        requireNames(
            value,
            'LAYER_WORKER_ENABLED',
            ['GDAL_OGR2OGR_PATH', 'GDAL_OGRINFO_PATH', 'PROJ_DATA_PATH', 'GDAL_DATA_PATH'],
            errors,
        );

        if (
            value.LAYER_WORKER_ENABLED === 'true' &&
            (value.STORAGE_ENABLED !== 'true' || value.GEOSERVER_ENABLED !== 'true')
        ) {
            errors.push(
                'LAYER_WORKER_ENABLED=true requires STORAGE_ENABLED=true and GEOSERVER_ENABLED=true',
            );
        }
        if (value.GOOGLE_CLIENT_ID && (!value.GOOGLE_CLIENT_SECRET || !value.GOOGLE_CALLBACK_URL)) {
            errors.push(
                'GOOGLE_CLIENT_SECRET and GOOGLE_CALLBACK_URL are required with GOOGLE_CLIENT_ID',
            );
        }
        const smtpValues = [value.SMTP_HOST, value.SMTP_USER, value.SMTP_PASS];
        if (smtpValues.some(Boolean) && !smtpValues.every(Boolean)) {
            errors.push('SMTP_HOST, SMTP_USER and SMTP_PASS must be configured together');
        }
        if (
            value.PUSH_ENABLED === 'true' &&
            !value.FIREBASE_SERVICE_ACCOUNT_BASE64 &&
            !value.FIREBASE_SERVICE_ACCOUNT &&
            !value.GOOGLE_APPLICATION_CREDENTIALS
        ) {
            errors.push('PUSH_ENABLED=true requires Firebase credentials');
        }
        requireNames(value, 'PUSH_ENABLED', ['DEVICE_TOKEN_ENCRYPTION_KEY'], errors);

        for (const name of [
            'MINIO_ACCESS_KEY_FILE',
            'MINIO_SECRET_KEY_FILE',
            'GEOSERVER_PASSWORD_FILE',
        ]) {
            if (
                (value.STORAGE_ENABLED === 'true' && name.startsWith('MINIO')) ||
                (value.GEOSERVER_ENABLED === 'true' && name.startsWith('GEOSERVER'))
            ) {
                checkReadableFile(value, name, errors, checkFiles);
            }
        }
        if (value.FIREBASE_SERVICE_ACCOUNT) {
            checkReadableFile(value, 'FIREBASE_SERVICE_ACCOUNT', errors, checkFiles);
        }
        if (value.GOOGLE_APPLICATION_CREDENTIALS) {
            checkReadableFile(value, 'GOOGLE_APPLICATION_CREDENTIALS', errors, checkFiles);
        }
    }

    if (errors.length) {
        throw new EnvValidationError(errors.map((item) => redactSecrets(item, source)));
    }
    return value;
};

const applyEnv = (value, target = process.env) => {
    for (const name of Object.keys(ENV_SCHEMA_KEYS)) {
        if (value[name] !== undefined) {
            target[name] = String(value[name]);
        }
    }
};

const loadEnv = (options = {}) => {
    const result = dotenv.config({ quiet: true, ...options.dotenv });
    if (result.error) {
        throw result.error;
    }
    const value = validateEnv(process.env, { checkFiles: options.checkFiles !== false });
    applyEnv(value);
    return value;
};

module.exports = { loadEnv, validateEnv, applyEnv, EnvValidationError };
