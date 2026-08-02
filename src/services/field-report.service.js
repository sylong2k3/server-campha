'use strict';
const repository = require('../repositories/field-report.repository');
const tokenRepository = require('../repositories/device-token.repository');
const minioService = require('./minio.service');
const systemLogger = require('../utils/systemLogger.util');
const {
    Api403Error,
    Api404Error,
    Api409Error,
    Api422Error,
    Api503Error,
} = require('../core/error.response');
const has = (actor, resource, action) => actor?.permissions?.[resource]?.[action] === true;
const requirePermission = (actor, action) => {
    if (!has(actor, 'field_report', action)) {
        throw new Api403Error('Không có quyền thực hiện thao tác phản ánh');
    }
};
const mapDatabaseError = (error) => {
    if (error.code === '23514') {
        throw new Api422Error('Chuyển trạng thái hoặc hình học không hợp lệ', [
            'FIELD_REPORT_CONSTRAINT',
        ]);
    }
    if (error.code === '23505') {
        throw new Api409Error('Dữ liệu phản ánh bị trùng', ['FIELD_REPORT_CONFLICT']);
    }
    throw error;
};
const listPublic = (filter) => repository.list(filter, 'public');
const nearby = (input) => repository.nearby(input);
const listMine = (filter, actor) => {
    requirePermission(actor, 'create');
    return repository.list(filter, 'mine', actor);
};
const create = async (input, actor) => {
    requirePermission(actor, 'create');
    if (input.measuredGeometry) {
        requirePermission(actor, 'measure');
    }
    try {
        const row = await repository.create(input, actor);
        if (!row) {
            throw new Api422Error(
                'Ảnh phản ánh chưa sẵn sàng, không thuộc người gửi hoặc không phải PNG/WebP',
                ['FIELD_PHOTO_INVALID'],
            );
        }
        systemLogger.logInfo('field_report', 'field_report_created', {
            actorId: actor.id,
            reportId: row.id,
            role: actor.role,
        });
        return row;
    } catch (error) {
        return mapDatabaseError(error);
    }
};
const listAdmin = (filter, actor) => {
    requirePermission(actor, 'read');
    systemLogger.logInfo('field_report', 'field_report_pii_list_accessed', {
        actorId: actor.id,
        role: actor.role,
    });
    return repository.list(filter, 'admin', actor);
};
const get = async (id, actor) => {
    let mode = 'mine';
    if (has(actor, 'field_report', 'read')) {
        mode = 'admin';
        systemLogger.logInfo('field_report', 'field_report_pii_accessed', {
            actorId: actor.id,
            reportId: id,
            role: actor.role,
        });
    }
    const row = await repository.find(id, mode, actor);
    if (!row) {
        throw new Api404Error('Không tìm thấy phản ánh');
    }
    const photos = await repository.photoObjects(id);
    row.photos = await Promise.all(
        photos.map(async (photo) => ({
            id: photo.id,
            originalName: photo.original_name,
            sizeBytes: photo.size_bytes,
            ...(await minioService.getPresignedDownloadUrl({
                objectKey: photo.object_key,
                category: 'field-photos',
                expireSeconds: 300,
            })),
        })),
    );
    row.history = await repository.history(id);
    return row;
};
const review = async (id, input, actor) => {
    const reviewers = ['ubnd_tp', 'so_tnmt', 'so_xd'];
    if (!reviewers.includes(actor.role)) {
        throw new Api403Error('Vai trò không được duyệt phản ánh');
    }
    requirePermission(actor, 'approve');
    try {
        const row = await repository.review(id, input, actor);
        if (!row) {
            if (!(await repository.find(id, 'admin', actor))) {
                throw new Api404Error('Không tìm thấy phản ánh');
            }
            throw new Api409Error('Phản ánh đã thay đổi; tải lại trước khi duyệt', [
                'OPTIMISTIC_LOCK_CONFLICT',
            ]);
        }
        systemLogger.logInfo('field_report', 'field_report_reviewed', {
            actorId: actor.id,
            reportId: id,
            status: input.status,
            role: actor.role,
        });
        return row;
    } catch (error) {
        return mapDatabaseError(error);
    }
};
const remove = async (id, expectedUpdatedAt, actor) => {
    const photos = await repository.photoObjects(id);
    const row = await repository.remove(id, expectedUpdatedAt, actor);
    if (!row) {
        throw new Api404Error('Không tìm thấy phản ánh hoặc dữ liệu đã thay đổi');
    }
    for (const photo of photos) {
        try {
            await minioService.removeObject({
                objectKey: photo.object_key,
                category: 'field-photos',
            });
            await repository.markPhotoDeleted(photo.id, actor.id);
        } catch (error) {
            systemLogger.logError('field_report', 'field_report_photo_delete_failed', {
                actorId: actor.id,
                reportId: id,
                fileId: photo.id,
                code: error.code,
            });
            throw new Api503Error('Phản ánh đã ẩn nhưng ảnh chưa xóa xong; vui lòng thử lại', [
                'FIELD_PHOTO_DELETE_PENDING',
            ]);
        }
    }
    systemLogger.logInfo('field_report', 'field_report_subject_deleted', {
        actorId: actor.id,
        reportId: id,
    });
    return row;
};
const clusters = (input, actor) => {
    requirePermission(actor, 'stats');
    return repository.clusters(input);
};
const registerDevice = (input, actor) =>
    tokenRepository.upsert(input.token, input.platform, actor.id);
const unregisterDevice = async (input, actor) => {
    const row = await tokenRepository.disable(input.token, actor.id);
    if (!row) {
        throw new Api404Error('Không tìm thấy thiết bị');
    }
    return row;
};
module.exports = {
    listPublic,
    nearby,
    listMine,
    create,
    listAdmin,
    get,
    review,
    remove,
    clusters,
    registerDevice,
    unregisterDevice,
};
