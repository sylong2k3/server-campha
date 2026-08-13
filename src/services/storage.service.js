'use strict';

const { randomUUID, createHash } = require('crypto');
const path = require('path');
const minioService = require('./minio.service');
const clamavService = require('./clamav.service');
const storageRepository = require('../repositories/storage.repository');
const { getBucketForCategory } = require('../configs/minioClient');
const { detectFileType, CATEGORY_EXTENSIONS } = require('../utils/file-signature.util');
const jwt = require('jsonwebtoken');
const {
    Api403Error,
    Api404Error,
    Api409Error,
    Api413Error,
    Api422Error,
    Api503Error,
} = require('../core/error.response');

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
    if (
        !CATEGORY_EXTENSIONS[category]?.has(extension) ||
        (category === 'field-photos' && !['image/png', 'image/webp'].includes(contentType))
    ) {
        throw new Api422Error('Loại file không được phép', ['FILE_EXTENSION_OR_MIME_NOT_ALLOWED']);
    }
};

const assertCreatePermission = (category, actor) => {
    const [resource, action] = CATEGORY_CREATE_PERMISSION[category] || [];
    if (!resource || actor?.permissions?.[resource]?.[action] !== true) {
        throw new Api403Error('Không có quyền tải file lên danh mục này');
    }
};

const allocateQuarantine = async ({ category, originalName, contentType, actor, expiresAt }) => {
    const nonce = randomUUID();
    const objectKey = minioService.buildObjectKey(nonce, originalName, category);
    const quarantineKey = `quarantine/${actor.id}/${nonce}/${path.basename(objectKey)}`;
    const record = await storageRepository.createQuarantine({
        category,
        bucket: getBucketForCategory(category),
        objectKey,
        quarantineKey,
        ownerUserId: actor.id,
        orgId: actor.orgId,
        originalName,
        expectedMime: contentType,
        expiresAt,
    });
    return { record, quarantineKey };
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
    for await (const chunk of stream) {
        size += chunk.length;
        hash.update(chunk);
    }
    return { size, sha256: hash.digest('hex') };
};

const rejectUpload = async (record, scanStatus) => {
    await storageRepository.markRejected(record.id, scanStatus);
    await minioService.removeQuarantineObject(record.quarantine_key).catch(() => {});
};

const commitUpload = async (id, actor) => {
    const record = await storageRepository.claimForScan(id, actor.id);
    if (!record) {
        throw new Api409Error('Upload không thể commit', ['UPLOAD_NOT_PENDING_OR_EXPIRED']);
    }
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
            throw new Api422Error('Nội dung file không khớp định dạng', [
                'FILE_SIGNATURE_MISMATCH',
            ]);
        }
        await clamavService.scanStream(
            await minioService.getQuarantineStream(record.quarantine_key),
        );
        const digest = await hashStream(
            await minioService.getQuarantineStream(record.quarantine_key),
        );
        if (digest.size !== Number(stat.size)) {
            await rejectUpload(record, 'error');
            throw new Api409Error('File thay đổi trong lúc kiểm tra', [
                'UPLOAD_CHANGED_DURING_SCAN',
            ]);
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
            await minioService
                .removeObject({ objectKey: record.object_key, category: record.category })
                .catch(() => {});
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
            throw new Api503Error('Dịch vụ quét mã độc tạm thời không khả dụng', [
                'MALWARE_SCANNER_UNAVAILABLE',
            ]);
        }
        // Safe no-op after rejectUpload; SQL only resets rows still in quarantine/scanning.
        await storageRepository.resetPending(record.id);
        throw error;
    }
};

const directUpload = async (
    { stream, category, originalName, contentType, contentLength },
    actor,
) => {
    assertCreatePermission(category, actor);
    assertExtension(category, originalName, contentType);
    if (!Number.isSafeInteger(contentLength) || contentLength <= 0) {
        throw new Api422Error('Dung lượng file không hợp lệ', ['INVALID_CONTENT_LENGTH']);
    }
    if (contentLength > MAX_BYTES[category]) {
        throw new Api413Error('File vượt giới hạn dung lượng', ['FILE_TOO_LARGE']);
    }

    let allocation;
    try {
        allocation = await allocateQuarantine({
            category,
            originalName,
            contentType,
            actor,
            expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        });
        await minioService.uploadStream({
            stream,
            objectKey: allocation.quarantineKey,
            mimeType: contentType,
            fileSize: contentLength,
            category,
            quarantine: true,
        });
        const stat = await minioService.statQuarantineObject(allocation.quarantineKey);
        if (Number(stat.size) !== contentLength) {
            throw new Api409Error('Kích thước file không khớp Content-Length', [
                'CONTENT_LENGTH_MISMATCH',
            ]);
        }
    } catch (error) {
        if (allocation) {
            await storageRepository.markRejected(allocation.record.id, 'error').catch(() => {});
            await minioService.removeQuarantineObject(allocation.quarantineKey).catch(() => {});
        }
        throw error;
    }
    return commitUpload(allocation.record.id, actor);
};

const getDownloadUrl = async (id, expireSeconds, actor) => {
    const record = await storageRepository.findAccessibleById(id, actor.id);
    if (!record || record.lifecycle_status !== 'ready') {
        throw new Api404Error('Không tìm thấy file');
    }
    return minioService.getPresignedDownloadUrl({
        objectKey: record.object_key,
        category: record.category,
        expireSeconds,
        fileId: record.id,
    });
};

const streamFile = async (id, ticket, actor) => {
    if (ticket) {
        try {
            const decoded = jwt.verify(ticket, process.env.JWT_SECRET);
            if (
                decoded.purpose !== 'file_download' ||
                Number(decoded.fileObjectId) !== Number(id)
            ) {
                throw new Api403Error('Vé tải file không hợp lệ');
            }
        } catch (err) {
            if (err instanceof Api403Error) {
                throw err;
            }
            throw new Api403Error('Vé tải file đã hết hạn hoặc không hợp lệ');
        }
    } else if (!actor || !actor.id) {
        throw new Api403Error('Yêu cầu vé tải file hoặc đăng nhập');
    }

    const record = ticket
        ? await storageRepository.findById(id)
        : await storageRepository.findAccessibleById(id, actor.id);
    if (!record || record.lifecycle_status !== 'ready') {
        throw new Api404Error('Không tìm thấy file');
    }

    const stream = await minioService.getObjectStream({
        objectKey: record.object_key,
        category: record.category,
    });

    return {
        stream,
        mimeType: record.detected_mime || record.expected_mime || 'application/pdf',
        sizeBytes: Number(record.size_bytes),
        originalName: record.original_name,
    };
};

const deleteObject = async (id, actor) => {
    const queued = await storageRepository.enqueueDelete(id, actor.id);
    if (queued?.conflict === 'FILE_STILL_IN_USE') {
        throw new Api409Error('File vẫn đang được dữ liệu khác sử dụng', [
            'FILE_STILL_IN_USE',
            ...queued.references,
        ]);
    }
    if (!queued) {
        throw new Api404Error('Không tìm thấy file');
    }
    return queued;
};

module.exports = {
    createPresignedUpload,
    directUpload,
    commitUpload,
    getDownloadUrl,
    streamFile,
    deleteObject,
    hashStream,
    MAX_BYTES,
};
