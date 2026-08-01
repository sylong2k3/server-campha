'use strict';

const { randomUUID, createHash } = require('crypto');
const path = require('path');
const minioService = require('./minio.service');
const clamavService = require('./clamav.service');
const storageRepository = require('../repositories/storage.repository');
const { getBucketForCategory } = require('../configs/minioClient');
const { detectFileType, CATEGORY_EXTENSIONS } = require('../utils/file-signature.util');
const { Api403Error, Api404Error, Api409Error, Api413Error, Api422Error, Api503Error } = require('../core/error.response');

const CATEGORY_CREATE_PERMISSION = Object.freeze({
    layers: ['layers', 'create'],
    raster: ['raster', 'create'],
    documents: ['documents', 'create'],
    'field-photos': ['field_report', 'create'],
});

const MAX_BYTES = Object.freeze({
    layers: Number(process.env.STORAGE_MAX_LAYER_MB || 500) * 1024 * 1024,
    raster: Number(process.env.STORAGE_MAX_RASTER_MB || 2048) * 1024 * 1024,
    documents: Number(process.env.STORAGE_MAX_DOCUMENT_MB || 50) * 1024 * 1024,
    'field-photos': Number(process.env.STORAGE_MAX_FIELD_PHOTO_MB || 10) * 1024 * 1024,
});

const assertExtension = (category, originalName, contentType) => {
    const extension = path.extname(originalName).toLowerCase();
    if (!CATEGORY_EXTENSIONS[category]?.has(extension)
        || (category === 'field-photos' && !['image/png', 'image/webp'].includes(contentType))) {
        throw new Api422Error('Loại file không được phép', ['FILE_EXTENSION_OR_MIME_NOT_ALLOWED']);
    }
};

const assertCreatePermission = (category, actor) => {
    const [resource, action] = CATEGORY_CREATE_PERMISSION[category] || [];
    if (!resource || actor?.permissions?.[resource]?.[action] !== true) {
        throw new Api403Error('Không có quyền tải file lên danh mục này');
    }
};

const createPresignedUpload = async (input, actor) => {
    assertCreatePermission(input.category, actor);
    assertExtension(input.category, input.originalName, input.contentType);
    const nonce = randomUUID();
    const objectKey = minioService.buildObjectKey(nonce, input.originalName, input.category);
    const quarantineKey = `quarantine/${actor.id}/${nonce}/${path.basename(objectKey)}`;
    const signed = await minioService.getPresignedUploadUrl(quarantineKey, input.expireSeconds);
    let record;
    try {
        record = await storageRepository.createQuarantine({
            category: input.category,
            bucket: getBucketForCategory(input.category),
            objectKey,
            quarantineKey,
            ownerUserId: actor.id,
            orgId: actor.orgId,
            originalName: input.originalName,
            expectedMime: input.contentType,
            expiresAt: signed.expiresAt,
        });
    } catch (error) {
        await minioService.removeQuarantineObject(quarantineKey).catch(() => {});
        throw error;
    }
    return { id: record.id, uploadUrl: signed.url, expiresAt: signed.expiresAt };
};

const hashStream = async (stream) => {
    const hash = createHash('sha256');
    let size = 0;
    for await (const chunk of stream) {size += chunk.length; hash.update(chunk);}
    return { size, sha256: hash.digest('hex') };
};

const rejectUpload = async (record, scanStatus) => {
    await storageRepository.markRejected(record.id, scanStatus);
    await minioService.removeQuarantineObject(record.quarantine_key).catch(() => {});
};

const commitUpload = async (id, actor) => {
    const record = await storageRepository.claimForScan(id, actor.id);
    if (!record) {throw new Api409Error('Upload không thể commit', ['UPLOAD_NOT_PENDING_OR_EXPIRED']);}
    try {
        const stat = await minioService.statQuarantineObject(record.quarantine_key);
        if (stat.size > MAX_BYTES[record.category]) {
            await rejectUpload(record, 'error');
            throw new Api413Error('File vượt giới hạn dung lượng', ['FILE_TOO_LARGE']);
        }
        const detectedMime = detectFileType({
            originalName: record.original_name,
            category: record.category,
            head: await minioService.getQuarantineHead(record.quarantine_key),
        });
        if (!detectedMime) {
            await rejectUpload(record, 'error');
            throw new Api422Error('Nội dung file không khớp định dạng', ['FILE_SIGNATURE_MISMATCH']);
        }
        await clamavService.scanStream(await minioService.getQuarantineStream(record.quarantine_key));
        const digest = await hashStream(await minioService.getQuarantineStream(record.quarantine_key));
        if (digest.size !== Number(stat.size)) {
            await rejectUpload(record, 'error');
            throw new Api409Error('File thay đổi trong lúc kiểm tra', ['UPLOAD_CHANGED_DURING_SCAN']);
        }
        await minioService.promoteQuarantineObject({
            quarantineKey: record.quarantine_key,
            objectKey: record.object_key,
            category: record.category,
            sourceEtag: stat.etag,
        });
        const ready = await storageRepository.markReady(record.id, {
            sizeBytes: digest.size,
            sha256: digest.sha256,
            detectedMime,
        });
        if (!ready) {
            await minioService.removeObject({ objectKey: record.object_key, category: record.category }).catch(() => {});
            throw new Api409Error('Upload state conflict', ['UPLOAD_STATE_CONFLICT']);
        }
        await minioService.removeQuarantineObject(record.quarantine_key).catch(() => {});
        return ready;
    } catch (error) {
        if (error instanceof clamavService.MalwareDetectedError) {
            await rejectUpload(record, 'infected');
            throw new Api422Error('File bị từ chối', ['MALWARE_DETECTED']);
        }
        if (error instanceof clamavService.ClamAvUnavailableError) {
            await storageRepository.resetPending(record.id);
            throw new Api503Error('Dịch vụ quét mã độc tạm thời không khả dụng', ['MALWARE_SCANNER_UNAVAILABLE']);
        }
        await storageRepository.resetPending(record.id);
        throw error;
    }
};

const getDownloadUrl = async (id, expireSeconds, actor) => {
    const record = await storageRepository.findAccessibleById(id, actor.id);
    if (!record || record.lifecycle_status !== 'ready') {throw new Api404Error('Không tìm thấy file');}
    return minioService.getPresignedDownloadUrl({
        objectKey: record.object_key, category: record.category, expireSeconds,
    });
};

const deleteObject = async (id, actor) => {
    const record = await storageRepository.findAccessibleById(id, actor.id);
    if (!record || record.lifecycle_status !== 'ready') {throw new Api404Error('Không tìm thấy file');}
    const deleted = await storageRepository.markDeleted(id, actor.id);
    if (!deleted) {throw new Api409Error('File state conflict');}
    await minioService.removeObject({ objectKey: record.object_key, category: record.category });
    return { id: deleted.id };
};

module.exports = { createPresignedUpload, commitUpload, getDownloadUrl, deleteObject, hashStream, MAX_BYTES };