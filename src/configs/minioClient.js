'use strict';

const fs = require('fs');
const Minio = require('minio');
const { t } = require('../utils/i18n.util');

const isEnabled = () => process.env.STORAGE_ENABLED === 'true';
const CATEGORY_BUCKET_ENV = Object.freeze({
    layers: 'MINIO_BUCKET_LAYERS',
    raster: 'MINIO_BUCKET_RASTER',
    documents: 'MINIO_BUCKET_DOCUMENTS',
    'field-photos': 'MINIO_BUCKET_FIELD_PHOTOS',
});
// Additive-optional categories introduced for the Flood/Hydrology domain
// (see @docs/GEE_FLOOD_INTEGRATION_ARCHITECTURE.md §7.2). These bucket env
// vars can be unset at boot without failing STORAGE_ENABLED=true validation.
// If the flood pipeline actually consumes an unconfigured category the
// getBucketForCategory() call throws with a clear "not configured" message.
const OPTIONAL_CATEGORY_BUCKET_ENV = Object.freeze({
    'flood-rasters': 'MINIO_BUCKET_FLOOD_RASTERS',
    'flood-calibration': 'MINIO_BUCKET_FLOOD_CALIBRATION',
    'forest-classification': 'MINIO_BUCKET_FOREST_CLASSIFICATION',
});
const BUCKET_PATTERN = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/;

const readSecretFile = (envName) => {
    const file = process.env[envName];
    if (!file) {
        throw new Error(`${envName} is required when STORAGE_ENABLED=true`);
    }
    const value = fs.readFileSync(file, 'utf8').trim();
    if (!value) {
        throw new Error(`${envName} is empty`);
    }
    return value;
};

const parsePort = (value) => {
    const port = Number(value || 9000);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new Error('MINIO_PORT must be an integer from 1 to 65535');
    }
    return port;
};

const getConfig = () => {
    if (!isEnabled()) {
        return null;
    }
    const endPoint = process.env.MINIO_ENDPOINT?.trim();
    if (!endPoint || endPoint.includes('://') || /[/\\@?#]/.test(endPoint)) {
        throw new Error('MINIO_ENDPOINT must be a hostname or IP address');
    }
    const buckets = Object.fromEntries(
        Object.entries(CATEGORY_BUCKET_ENV).map(([category, envName]) => {
            const name = process.env[envName]?.trim();
            if (!name || !BUCKET_PATTERN.test(name)) {
                throw new Error(`${envName} is invalid`);
            }
            return [category, name];
        }),
    );
    // Optional flood-domain buckets: include when set, skip when unset. The
    // flood pipeline enforces presence at consume time (getBucketForCategory).
    for (const [category, envName] of Object.entries(OPTIONAL_CATEGORY_BUCKET_ENV)) {
        const name = process.env[envName]?.trim();
        if (!name) {continue;}
        if (!BUCKET_PATTERN.test(name)) {
            throw new Error(`${envName} is invalid`);
        }
        buckets[category] = name;
    }
    const quarantineBucket = process.env.MINIO_BUCKET_QUARANTINE?.trim();
    if (!quarantineBucket || !BUCKET_PATTERN.test(quarantineBucket)) {
        throw new Error('MINIO_BUCKET_QUARANTINE is invalid');
    }
    const allBuckets = [...Object.values(buckets), quarantineBucket];
    if (new Set(allBuckets).size !== allBuckets.length) {
        throw new Error('MinIO bucket names must be unique');
    }
    return {
        endPoint,
        port: parsePort(process.env.MINIO_PORT),
        useSSL: process.env.MINIO_USE_SSL === 'true',
        accessKey: readSecretFile('MINIO_ACCESS_KEY_FILE'),
        secretKey: readSecretFile('MINIO_SECRET_KEY_FILE'),
        region: process.env.MINIO_REGION || 'us-east-1',
        buckets,
        quarantineBucket,
    };
};

let client;
let clientConfig;
const getClient = () => {
    const config = getConfig();
    if (!config) {
        throw new Error('Object storage is disabled');
    }
    if (!client) {
        client = new Minio.Client({
            endPoint: config.endPoint,
            port: config.port,
            useSSL: config.useSSL,
            accessKey: config.accessKey,
            secretKey: config.secretKey,
            region: config.region,
        });
        clientConfig = config;
    }
    return client;
};

const ensureBucket = async (minio, bucketName, region) => {
    if (!(await minio.bucketExists(bucketName))) {
        await minio.makeBucket(bucketName, region);
    }
    // Empty policy has no anonymous statements. IAM credentials remain controlled separately.
    await minio.setBucketPolicy(
        bucketName,
        JSON.stringify({ Version: '2012-10-17', Statement: [] }),
    );
};

const initMinio = async () => {
    if (!isEnabled()) {
        return false;
    }
    try {
        const minio = getClient();
        const config = clientConfig;
        await Promise.all(
            [...Object.values(config.buckets), config.quarantineBucket].map((bucket) =>
                ensureBucket(minio, bucket, config.region),
            ),
        );
        await minio.setBucketLifecycle(config.quarantineBucket, {
            Rule: [
                {
                    ID: 'expire-quarantine',
                    Status: 'Enabled',
                    Filter: { Prefix: '' },
                    Expiration: { Days: 1 },
                    AbortIncompleteMultipartUpload: { DaysAfterInitiation: 1 },
                },
            ],
        });
        console.info(t('minio_connected', process.env.APP_LANG || 'vi'));
        return true;
    } catch (error) {
        console.error(t('minio_connection_failed', process.env.APP_LANG || 'vi'), error.message);
        return false;
    }
};

const healthCheck = async () => {
    if (!isEnabled()) {
        return false;
    }
    try {
        const minio = getClient();
        const config = clientConfig;
        const checks = await Promise.all(
            [...Object.values(config.buckets), config.quarantineBucket].map((bucket) =>
                minio.bucketExists(bucket),
            ),
        );
        return checks.every(Boolean);
    } catch {
        return false;
    }
};

const getBucketForCategory = (category) => {
    const config = getConfig();
    const bucket = config?.buckets[category];
    if (!bucket) {
        // Distinguish "unknown category" from "known-but-optional and unset"
        // so operators can act on the error without reading the source.
        if (Object.prototype.hasOwnProperty.call(OPTIONAL_CATEGORY_BUCKET_ENV, category)) {
            throw new Error(
                `Storage category "${category}" is optional and not configured. ` +
                    `Set ${OPTIONAL_CATEGORY_BUCKET_ENV[category]} to enable it.`,
            );
        }
        throw new TypeError(`Unsupported storage category: ${category}`);
    }
    return bucket;
};

const hasBucketCategory = (category) => {
    try {
        const config = getConfig();
        return Boolean(config?.buckets[category]);
    } catch {
        return false;
    }
};

const getQuarantineBucket = () => {
    const config = getConfig();
    if (!config) {
        throw new Error('Object storage is disabled');
    }
    return config.quarantineBucket;
};

module.exports = {
    isEnabled,
    getConfig,
    getClient,
    initMinio,
    healthCheck,
    getBucketForCategory,
    hasBucketCategory,
    getQuarantineBucket,
    CATEGORY_BUCKET_ENV,
    OPTIONAL_CATEGORY_BUCKET_ENV,
};
