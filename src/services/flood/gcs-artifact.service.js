'use strict';

const { Storage } = require('@google-cloud/storage');
const debug = require('./debug.util');

let storageClient = null;

function config() {
    const bucket = process.env.FLOOD_GCS_BUCKET?.trim();
    const keyFilename =
        process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim() || process.env.GEE_KEY_PATH?.trim();
    if (!bucket) {
        const error = new Error('FLOOD_GCS_BUCKET is required for durable flood exports');
        error.code = 'FLOOD_GCS_NOT_CONFIGURED';
        throw error;
    }
    return {
        bucket,
        keyFilename: keyFilename || undefined,
        signedUrlSeconds: Math.max(
            60,
            Math.min(86400, Number(process.env.FLOOD_GCS_SIGNED_URL_SECONDS) || 3600),
        ),
    };
}

function client() {
    if (!storageClient) {
        const { keyFilename } = config();
        storageClient = new Storage(keyFilename ? { keyFilename } : {});
    }
    return storageClient;
}

async function signedDownloadUrl(objectName) {
    const { bucket, signedUrlSeconds } = config();
    debug.log('gcs.signedDownloadUrl request', { bucket, objectName, signedUrlSeconds });
    const [url] = await client()
        .bucket(bucket)
        .file(objectName)
        .getSignedUrl({
            version: 'v4',
            action: 'read',
            expires: Date.now() + signedUrlSeconds * 1000,
        });
    debug.log('gcs.signedDownloadUrl ok', { bucket, objectName });
    return { bucket, objectName, url };
}

async function waitForObject(objectName, { attempts = 12, intervalMs = 5000 } = {}) {
    const { bucket } = config();
    debug.log('gcs.waitForObject start', { bucket, objectName, attempts, intervalMs });
    const file = client().bucket(bucket).file(objectName);
    for (let attempt = 0; attempt < attempts; attempt += 1) {
        const [exists] = await file.exists();
        if (exists) {
            debug.log('gcs.waitForObject found', { bucket, objectName, attempt: attempt + 1 });
            return { bucket, objectName };
        }
        debug.log('gcs.waitForObject miss', {
            bucket,
            objectName,
            attempt: attempt + 1,
            of: attempts,
        });
        await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
    const error = new Error(`GCS export object did not appear: gs://${bucket}/${objectName}`);
    error.code = 'GCS_OBJECT_NOT_FOUND';
    debug.logError('gcs.waitForObject timeout', error, { bucket, objectName });
    throw error;
}

async function deleteObject(objectName) {
    const { bucket } = config();
    debug.log('gcs.deleteObject', { bucket, objectName });
    await client().bucket(bucket).file(objectName).delete({ ignoreNotFound: true });
}

function __resetForTests() {
    storageClient = null;
}

module.exports = { config, waitForObject, signedDownloadUrl, deleteObject, __resetForTests };
