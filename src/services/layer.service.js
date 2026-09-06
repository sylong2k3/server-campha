'use strict';

const layerRepository = require('../repositories/layer.repository');
const webMapRepository = require('../repositories/web-map.repository');
const jobRepository = require('../repositories/layer-job.repository');
const geoserverClient = require('../utils/geoserver.client');
const systemLogger = require('../utils/systemLogger.util');
const { Api403Error, Api404Error, Api409Error, Api422Error } = require('../core/error.response');
const { toIso19139Xml } = require('../utils/geographic-metadata.util');

const hasPermission = (actor, action) => actor?.permissions?.layers?.[action] === true;
const assertPermission = (actor, action) => {
    if (!hasPermission(actor, action)) {
        throw new Api403Error('Không có quyền thực hiện thao tác lớp dữ liệu');
    }
};
const audit = (action, actor, metadata) =>
    systemLogger.logInfo('layers', action, {
        actorId: actor.id,
        role: actor.role,
        orgId: actor.orgId,
        ...metadata,
    });

const enqueueImport = async (importType, input, actor) => {
    assertPermission(actor, 'create');
    try {
        const job = await jobRepository.createImport({
            importType,
            fileObjectId: input.fileObjectId,
            ownerUserId: actor.id,
            orgId: actor.orgId,
            inputPayload: input,
        });
        if (!job) {
            throw new Api422Error(
                'File nguồn không sạch, không thuộc người dùng hoặc không tồn tại',
                ['SOURCE_FILE_NOT_READY'],
            );
        }
        audit('layer_import_queued', actor, {
            jobId: job.id,
            importType,
            fileObjectId: input.fileObjectId,
            code: input.code,
        });
        return job;
    } catch (error) {
        if (error?.code === '23514' && error.constraint === 'file_cleanup_reference_guard') {
            throw new Api409Error('File đang chờ xóa', ['FILE_DELETE_PENDING']);
        }
        if (error.code === '23505') {
            throw new Api409Error('File đang có import job hoạt động', ['IMPORT_ALREADY_ACTIVE']);
        }
        throw error;
    }
};

const getImport = async (id, actor) => {
    assertPermission(actor, 'read');
    const job = await jobRepository.findImportById(id, actor);
    if (!job) {
        throw new Api404Error('Không tìm thấy import job');
    }
    return job;
};

const listImportErrors = async (id, page, limit, actor) => {
    await getImport(id, actor);
    return jobRepository.listImportErrors(id, actor, page, limit);
};

const listLayers = async (filter, actor) => {
    assertPermission(actor, 'read');
    return layerRepository.list(filter);
};
const getLayer = async (id, actor) => {
    assertPermission(actor, 'read');
    const layer = await layerRepository.findById(id);
    if (!layer) {
        throw new Api404Error('Không tìm thấy lớp dữ liệu');
    }
    return layer;
};
const standardMetadata = async (id, actor) => {
    const layer = await getLayer(id, actor);
    const profile = layer.metadata?.standardProfile;
    if (!profile) {
        throw new Api404Error('Lớp chưa có siêu dữ liệu chuẩn');
    }
    return { layer, profile };
};
const updateStandardMetadata = async (id, input, actor) => {
    assertPermission(actor, 'update');
    const { expectedUpdatedAt, ...profile } = input;
    const layer = await layerRepository.updateStandardMetadata(id, profile, expectedUpdatedAt);
    if (!layer) {
        const existing = await layerRepository.findById(id);
        if (!existing) {
            throw new Api404Error('Không tìm thấy lớp dữ liệu');
        }
        throw new Api409Error('Lớp đã được thay đổi; tải lại dữ liệu trước khi cập nhật', [
            'OPTIMISTIC_LOCK_CONFLICT',
        ]);
    }
    webMapRepository.invalidateLayerCache(id);
    audit('layer_standard_metadata_updated', actor, {
        layerId: id,
        metadataIdentifier: profile.metadataIdentifier,
    });
    return { layerId: layer.id, profile, updatedAt: layer.updated_at, version: layer.version };
};
const standardMetadataXml = async (id, actor) => {
    const { layer, profile } = await standardMetadata(id, actor);
    return { code: layer.code, xml: toIso19139Xml(layer, profile) };
};
const updateLayer = async (id, input, actor) => {
    assertPermission(actor, 'update');
    if (
        input.minZoom !== undefined &&
        input.maxZoom !== undefined &&
        input.minZoom !== null &&
        input.maxZoom !== null &&
        input.minZoom > input.maxZoom
    ) {
        throw new Api422Error('minZoom không được lớn hơn maxZoom', ['INVALID_ZOOM_RANGE']);
    }
    const layer = await layerRepository.updateMetadata(id, input);
    if (!layer) {
        const existing = await layerRepository.findById(id);
        if (!existing) {
            throw new Api404Error('Không tìm thấy lớp dữ liệu');
        }
        throw new Api409Error('Lớp đã được thay đổi; tải lại dữ liệu trước khi cập nhật', [
            'OPTIMISTIC_LOCK_CONFLICT',
        ]);
    }
    webMapRepository.invalidateLayerCache(id);
    audit('layer_updated', actor, {
        layerId: id,
        fields: Object.keys(input).filter((key) => key !== 'expectedUpdatedAt'),
    });
    return layer;
};

const replacePermissions = async (id, input, actor) => {
    assertPermission(actor, 'grant');
    const roleCodes = input.permissions.map((item) => item.roleCode);
    const active = await layerRepository.activeRoleCodes(roleCodes);
    if (active.length !== new Set(roleCodes).size) {
        throw new Api422Error('ACL chứa vai trò không tồn tại hoặc đã bị khóa', ['INVALID_ROLE']);
    }
    // Role contracts are an upper bound: only TNMT can edit/delete. Public/cross-agency roles are read/export only.
    for (const permission of input.permissions) {
        if (permission.roleCode !== 'so_tnmt' && (permission.canEdit || permission.canDelete)) {
            throw new Api422Error('Chỉ vai trò so_tnmt được cấp edit/delete', [
                'ACL_EXCEEDS_ROLE_CONTRACT',
            ]);
        }
    }
    const layer = await layerRepository.replacePermissions(id, input.permissions);
    if (!layer) {
        throw new Api404Error('Không tìm thấy lớp dữ liệu');
    }
    webMapRepository.invalidateLayerCache(id);
    audit('layer_permissions_replaced', actor, { layerId: id, roleCodes });
    return layer;
};

const deleteLayer = async (id, expectedUpdatedAt, deleteFiles, actor) => {
    assertPermission(actor, 'delete');
    const layer = await layerRepository.softDeleteAndEnqueue(
        id,
        expectedUpdatedAt,
        actor.id,
        deleteFiles,
    );
    if (layer?.conflict === 'FILE_STILL_IN_USE') {
        throw new Api409Error('File nguồn vẫn đang được ảnh viễn thám sử dụng', [
            'FILE_STILL_IN_USE',
            ...layer.references,
        ]);
    }
    if (!layer) {
        const existing = await layerRepository.findById(id, true);
        if (!existing || existing.deleted_at) {
            throw new Api404Error('Không tìm thấy lớp dữ liệu');
        }
        throw new Api409Error('Lớp đã được thay đổi; tải lại dữ liệu trước khi xóa', [
            'OPTIMISTIC_LOCK_CONFLICT',
        ]);
    }
    webMapRepository.invalidateLayerCache(id);
    audit('layer_soft_deleted', actor, { layerId: id, deleteFiles });
    return {
        id: layer.id,
        cleanupStatus: layer.cleanup_status,
        fileCleanupQueued: layer.fileCleanupQueued,
        fileObjectIds: layer.fileObjectIds,
    };
};

const cleanupView = (state, actor) => ({
    layerId: state.layer_id,
    code: state.code,
    deletedAt: state.deleted_at,
    cleanupStatus: state.cleanup_status,
    updatedAt: state.layer_updated_at,
    canRetry: Boolean(
        hasPermission(actor, 'delete') &&
        state.deleted_at &&
        state.cleanup_status !== 'complete' &&
        state.job_status === 'failed',
    ),
    job: state.job_id
        ? {
              id: state.job_id,
              status: state.job_status,
              attempt: state.attempt,
              maxAttempts: state.max_attempts,
              nextAttemptAt: state.job_status === 'queued' ? state.next_attempt_at : null,
              startedAt: state.started_at,
              finishedAt: state.finished_at,
              createdAt: state.created_at,
              updatedAt: state.updated_at,
          }
        : null,
});
const getCleanup = async (id, actor) => {
    assertPermission(actor, 'read');
    const state = await jobRepository.findCleanupStatus(id);
    if (!state) {
        throw new Api404Error('Không tìm thấy lớp dữ liệu');
    }
    return cleanupView(state, actor);
};
const retryCleanup = async (id, actor) => {
    assertPermission(actor, 'delete');
    const result = await jobRepository.retryCleanup(id);
    if (!result) {
        throw new Api404Error('Không tìm thấy lớp dữ liệu');
    }
    if (result.conflict) {
        const messages = {
            LAYER_NOT_DELETED: 'Chỉ được dọn lại lớp đã xóa',
            LAYER_CLEANUP_ALREADY_ACTIVE: 'Cleanup đang chờ hoặc đang chạy; không tạo job trùng',
            LAYER_CLEANUP_NOT_RETRYABLE:
                'Chỉ được thử lại khi job cleanup thất bại và lớp chưa dọn xong',
        };
        throw new Api409Error(messages[result.conflict], [result.conflict]);
    }
    audit('layer_cleanup_retried', actor, {
        layerId: id,
        previousJobId: result.previousJobId,
        jobId: result.state.job_id,
    });
    return cleanupView(result.state, actor);
};

const retryPublish = async (id, actor) => {
    assertPermission(actor, 'update');
    const layer = await layerRepository.findById(id);
    if (!layer) {
        throw new Api404Error('Không tìm thấy lớp dữ liệu');
    }
    if (layer.storage_kind !== 'postgis' || !layer.table_name) {
        throw new Api422Error('Lớp không phải PostGIS vector', ['NOT_VECTOR_LAYER']);
    }
    try {
        const geoserverLayer = await geoserverClient.publishVectorLayer({
            ...layer,
            epsg_code: layer.srid,
        });
        const published = await layerRepository.setPublishState(id, 'published', geoserverLayer);
        webMapRepository.invalidateLayerCache(id);
        return published;
    } catch (error) {
        await layerRepository.setPublishState(id, 'failed');
        webMapRepository.invalidateLayerCache(id);
        throw error;
    }
};

module.exports = {
    enqueueImport,
    getImport,
    listImportErrors,
    listLayers,
    getLayer,
    standardMetadata,
    updateStandardMetadata,
    standardMetadataXml,
    updateLayer,
    replacePermissions,
    deleteLayer,
    getCleanup,
    retryCleanup,
    retryPublish,
};
