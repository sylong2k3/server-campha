'use strict';

const layerRepository = require('../repositories/layer.repository');
const jobRepository = require('../repositories/layer-job.repository');
const geoserverClient = require('../utils/geoserver.client');
const systemLogger = require('../utils/systemLogger.util');
const { Api403Error, Api404Error, Api409Error, Api422Error } = require('../core/error.response');

const assertTnmt = (actor) => {
    if (actor?.role !== 'so_tnmt') { throw new Api403Error('Chỉ Sở TNMT được quản trị lớp dữ liệu'); }
};
const hasPermission = (actor, action) => actor?.permissions?.layers?.[action] === true;
const assertPermission = (actor, action) => {
    if (!hasPermission(actor, action)) { throw new Api403Error('Không có quyền thực hiện thao tác lớp dữ liệu'); }
    if (['update', 'delete', 'grant'].includes(action)) { assertTnmt(actor); }
};
const audit = (action, actor, metadata) => systemLogger.logInfo('layers', action, {
    actorId: actor.id, role: actor.role, orgId: actor.orgId, ...metadata,
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
        if (!job) { throw new Api422Error('File nguồn không sạch, không thuộc người dùng hoặc không tồn tại', ['SOURCE_FILE_NOT_READY']); }
        audit('layer_import_queued', actor, { jobId: job.id, importType, fileObjectId: input.fileObjectId, code: input.code });
        return job;
    } catch (error) {
        if (error.code === '23505') { throw new Api409Error('File đang có import job hoạt động', ['IMPORT_ALREADY_ACTIVE']); }
        throw error;
    }
};

const getImport = async (id, actor) => {
    assertPermission(actor, 'read');
    const job = await jobRepository.findImportById(id, actor);
    if (!job) { throw new Api404Error('Không tìm thấy import job'); }
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
    if (!layer) { throw new Api404Error('Không tìm thấy lớp dữ liệu'); }
    return layer;
};
const updateLayer = async (id, input, actor) => {
    assertPermission(actor, 'update');
    if (input.minZoom !== undefined && input.maxZoom !== undefined && input.minZoom !== null && input.maxZoom !== null && input.minZoom > input.maxZoom) {
        throw new Api422Error('minZoom không được lớn hơn maxZoom', ['INVALID_ZOOM_RANGE']);
    }
    const layer = await layerRepository.updateMetadata(id, input);
    if (!layer) {
        const existing = await layerRepository.findById(id);
        if (!existing) { throw new Api404Error('Không tìm thấy lớp dữ liệu'); }
        throw new Api409Error('Lớp đã được thay đổi; tải lại dữ liệu trước khi cập nhật', ['OPTIMISTIC_LOCK_CONFLICT']);
    }
    audit('layer_updated', actor, { layerId: id, fields: Object.keys(input).filter((key) => key !== 'expectedUpdatedAt') });
    return layer;
};

const replacePermissions = async (id, input, actor) => {
    assertPermission(actor, 'grant');
    const roleCodes = input.permissions.map((item) => item.roleCode);
    const active = await layerRepository.activeRoleCodes(roleCodes);
    if (active.length !== new Set(roleCodes).size) { throw new Api422Error('ACL chứa vai trò không tồn tại hoặc đã bị khóa', ['INVALID_ROLE']); }
    // Role contracts are an upper bound: only TNMT can edit/delete. Public/cross-agency roles are read/export only.
    for (const permission of input.permissions) {
        if (permission.roleCode !== 'so_tnmt' && (permission.canEdit || permission.canDelete)) {
            throw new Api422Error('Chỉ vai trò so_tnmt được cấp edit/delete', ['ACL_EXCEEDS_ROLE_CONTRACT']);
        }
    }
    const layer = await layerRepository.replacePermissions(id, input.permissions);
    if (!layer) { throw new Api404Error('Không tìm thấy lớp dữ liệu'); }
    audit('layer_permissions_replaced', actor, { layerId: id, roleCodes });
    return layer;
};

const deleteLayer = async (id, expectedUpdatedAt, actor) => {
    assertPermission(actor, 'delete');
    const layer = await layerRepository.softDeleteAndEnqueue(id, expectedUpdatedAt);
    if (!layer) {
        const existing = await layerRepository.findById(id, true);
        if (!existing || existing.deleted_at) { throw new Api404Error('Không tìm thấy lớp dữ liệu'); }
        throw new Api409Error('Lớp đã được thay đổi; tải lại dữ liệu trước khi xóa', ['OPTIMISTIC_LOCK_CONFLICT']);
    }
    audit('layer_soft_deleted', actor, { layerId: id });
    return { id: layer.id, cleanupStatus: layer.cleanup_status };
};

const retryPublish = async (id, actor) => {
    assertPermission(actor, 'update');
    const layer = await layerRepository.findById(id);
    if (!layer) { throw new Api404Error('Không tìm thấy lớp dữ liệu'); }
    if (layer.storage_kind !== 'postgis' || !layer.table_name) { throw new Api422Error('Lớp không phải PostGIS vector', ['NOT_VECTOR_LAYER']); }
    try {
        const geoserverLayer = await geoserverClient.publishVectorLayer({ ...layer, epsg_code: layer.srid });
        return layerRepository.setPublishState(id, 'published', geoserverLayer);
    } catch (error) {
        await layerRepository.setPublishState(id, 'failed');
        throw error;
    }
};

module.exports = {
    enqueueImport, getImport, listImportErrors, listLayers, getLayer,
    updateLayer, replacePermissions, deleteLayer, retryPublish,
};
