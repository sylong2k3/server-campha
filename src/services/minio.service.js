const path = require('path');
const { pipeline } = require('stream/promises');
const fs = require('fs');
const { CopyConditions } = require('minio');
const { getClient, getBucketForCategory, getQuarantineBucket } = require('../configs/minioClient');

const PRESIGNED_DOWNLOAD_EXPIRE = Number(process.env.MINIO_PRESIGNED_EXPIRE_SECONDS) || 900;
const PRESIGNED_UPLOAD_EXPIRE = Number(process.env.MINIO_UPLOAD_PRESIGNED_EXPIRE_SECONDS) || 900;
const MIN_PRESIGN_SECONDS = 60;
const MAX_PRESIGN_SECONDS = 3600;

const boundedExpiry = (value, fallback) => {
    const seconds = Number(value || fallback);
    if (
        !Number.isInteger(seconds) ||
        seconds < MIN_PRESIGN_SECONDS ||
        seconds > MAX_PRESIGN_SECONDS
    ) {
        throw new RangeError(
            `Presigned expiry must be ${MIN_PRESIGN_SECONDS}-${MAX_PRESIGN_SECONDS} seconds`,
        );
    }
    return seconds;
};

const safeName = (originalName) => {
    const ext = path
        .extname(originalName || '')
        .toLowerCase()
        .replace(/[^a-z0-9.]/g, '');
    const base =
        path
            .basename(originalName || 'file', path.extname(originalName || ''))
            .normalize('NFKD')
            .replace(/[^a-zA-Z0-9_-]/g, '_')
            .toLowerCase()
            .slice(0, 80) || 'file';
    return `${base}${ext}`;
};

const buildObjectKey = (id, originalName, prefix = '') => {
    if (!/^[a-z0-9-]{1,64}$/.test(String(id))) {
        throw new TypeError('Object id is invalid');
    }
    if (prefix && !/^[a-z0-9/_-]{1,80}$/.test(prefix)) {
        throw new TypeError('Invalid object key prefix');
    }
    const now = new Date();
    const datePath = `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
    return `${prefix ? `${prefix}/` : ''}${datePath}/${id}/${safeName(originalName)}`;
};

const uploadStream = async ({
    stream,
    objectKey,
    mimeType,
    fileSize,
    category,
    quarantine = false,
}) => {
    const bucket = quarantine ? getQuarantineBucket() : getBucketForCategory(category);
    const result = await getClient().putObject(bucket, objectKey, stream, fileSize || undefined, {
        'Content-Type': mimeType || 'application/octet-stream',
    });
    return { etag: result.etag, objectKey, bucket };
};

const uploadBuffer = (buffer, options) => {
    if (!Buffer.isBuffer(buffer)) {
        throw new TypeError('buffer must be a Buffer');
    }
    return uploadStream({ ...options, stream: buffer, fileSize: buffer.length });
};

const getPresignedUploadUrl = async (objectKey, expireSeconds) => {
    const expire = boundedExpiry(expireSeconds, PRESIGNED_UPLOAD_EXPIRE);
    const bucket = getQuarantineBucket();
    let url = await getClient().presignedPutObject(bucket, objectKey, expire);
    if (process.env.MINIO_PUBLIC_URL) {
        const publicUrl = process.env.MINIO_PUBLIC_URL.replace(/\/+$/, '');
        url = url.replace(/^https?:\/\/[^/]+/, publicUrl);
    } else if (url.includes('localhost') || url.includes('127.0.0.1')) {
        const publicHost = `http://${process.env.MINIO_ENDPOINT || '103.163.119.247'}:${process.env.MINIO_PORT || 9000}`;
        url = url.replace(/^https?:\/\/[^/]+/, publicHost);
    }
    return { url, expiresAt: new Date(Date.now() + expire * 1000), objectKey };
};

const getPresignedDownloadUrl = async ({ objectKey, category, expireSeconds, fileId }) => {
    const expire = boundedExpiry(expireSeconds, PRESIGNED_DOWNLOAD_EXPIRE);
    if (fileId) {
        const jwt = require('jsonwebtoken');
        const ticket = jwt.sign(
            { fileObjectId: fileId, purpose: 'file_download' },
            process.env.JWT_SECRET || 'secret',
            { expiresIn: `${expire}s` },
        );
        const baseUrl = process.env.API_BASE_URL || 'https://apicampha.tourismpj.pro.vn/api/v1';
        const url = `${baseUrl}/storage/objects/${fileId}/file?ticket=${ticket}`;
        return { url, expiresAt: new Date(Date.now() + expire * 1000) };
    }
    let url = await getClient().presignedGetObject(
        getBucketForCategory(category),
        objectKey,
        expire,
    );
    if (process.env.MINIO_PUBLIC_URL) {
        const publicUrl = process.env.MINIO_PUBLIC_URL.replace(/\/+$/, '');
        url = url.replace(/^https?:\/\/[^/]+/, publicUrl);
    } else if (url.includes('localhost') || url.includes('127.0.0.1')) {
        const publicHost = `http://${process.env.MINIO_ENDPOINT || '103.163.119.247'}:${process.env.MINIO_PORT || 9000}`;
        url = url.replace(/^https?:\/\/[^/]+/, publicHost);
    }
    return { url, expiresAt: new Date(Date.now() + expire * 1000) };
};

const statQuarantineObject = (objectKey) =>
    getClient().statObject(getQuarantineBucket(), objectKey);
const getQuarantineStream = (objectKey) => getClient().getObject(getQuarantineBucket(), objectKey);
const getQuarantineHead = async (objectKey, length = 8192) => {
    const stream = await getClient().getPartialObject(getQuarantineBucket(), objectKey, 0, length);
    const chunks = [];
    for await (const chunk of stream) {
        chunks.push(chunk);
    }
    return Buffer.concat(chunks);
};

const promoteQuarantineObject = async ({ quarantineKey, objectKey, category, sourceEtag }) => {
    const client = getClient();
    const sourceBucket = getQuarantineBucket();
    const targetBucket = getBucketForCategory(category);
    const conditions = new CopyConditions();
    if (!sourceEtag) {
        throw new TypeError('sourceEtag is required for promotion');
    }
    conditions.setMatchETag(sourceEtag);
    await client.copyObject(
        targetBucket,
        objectKey,
        `/${sourceBucket}/${quarantineKey}`,
        conditions,
    );
    return { bucket: targetBucket, objectKey };
};

const removeQuarantineObject = (objectKey) =>
    getClient().removeObject(getQuarantineBucket(), objectKey);
const removeObject = ({ objectKey, category }) =>
    getClient().removeObject(getBucketForCategory(category), objectKey);
const getObjectStream = ({ objectKey, category }) =>
    getClient().getObject(getBucketForCategory(category), objectKey);

const getObjectMeta = async ({ objectKey, category }) => {
    const stat = await getClient().statObject(getBucketForCategory(category), objectKey);
    return {
        size: stat.size,
        etag: stat.etag,
        lastModified: stat.lastModified,
        contentType: stat.metaData?.['content-type'] || 'application/octet-stream',
        metaData: stat.metaData || {},
    };
};

const objectExists = async ({ objectKey, category }) => {
    try {
        await getClient().statObject(getBucketForCategory(category), objectKey);
        return true;
    } catch (error) {
        if (['NoSuchKey', 'NotFound', 'NoSuchObject'].includes(error.code)) {
            return false;
        }
        throw error;
    }
};

const downloadToFile = async ({ objectKey, category, destPath }) => {
    await pipeline(await getObjectStream({ objectKey, category }), fs.createWriteStream(destPath));
    return destPath;
};

module.exports = {
    boundedExpiry,
    buildObjectKey,
    uploadStream,
    uploadBuffer,
    getPresignedUploadUrl,
    getPresignedDownloadUrl,
    statQuarantineObject,
    getQuarantineStream,
    getQuarantineHead,
    promoteQuarantineObject,
    removeQuarantineObject,
    removeObject,
    getObjectStream,
    getObjectMeta,
    objectExists,
    downloadToFile,
};
