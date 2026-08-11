'use strict';
const repository = require('../repositories/mobile-gis.repository');
const webMapRepository = require('../repositories/web-map.repository');
const editRepository = require('../repositories/mobile-feature-edit.repository');
const weatherClient = require('../utils/openweather.client');
const weatherConfig = require('../configs/weather');
const {
    Api403Error,
    Api404Error,
    Api409Error,
    Api422Error,
    Api503Error,
} = require('../core/error.response');
const permitted = (actor, resource, action) => actor?.permissions?.[resource]?.[action] === true;
const requirePermission = (actor, resource, action) => {
    if (actor && !permitted(actor, resource, action)) {
        throw new Api403Error('Không có quyền sử dụng chức năng mobile GIS');
    }
};
const getLayer = async (id, actor) => {
    const row = await webMapRepository.accessibleLayer(id, actor);
    if (!row || row.publish_status !== 'published') {
        throw new Api404Error('Không tìm thấy lớp bản đồ');
    }
    if (row.storage_kind !== 'postgis' || !row.table_name) {
        throw new Api422Error('Lớp không hỗ trợ dữ liệu vector', ['NOT_VECTOR_LAYER']);
    }
    return row;
};
const tile = async (id, z, x, y, actor) => {
    requirePermission(actor, 'map', 'view');
    const row = await getLayer(id, actor);
    if (z < (row.min_zoom ?? 0) || z > (row.max_zoom ?? 22)) {
        return Buffer.alloc(0);
    }
    return repository.vectorTile(row, z, x, y);
};
const feature = async (id, featureId, actor) => {
    requirePermission(actor, 'map', 'view_attributes');
    const row = await getLayer(id, actor),
        item = await webMapRepository.featureById(row, featureId, true);
    if (!item) {
        throw new Api404Error('Không tìm thấy đối tượng');
    }
    if (
        actor?.role === 'so_tnmt' &&
        actor.permissions?.map_feature?.update === true &&
        row.role_can_edit
    ) {
        const snapshot = await editRepository.snapshot(row, featureId),
            current = await editRepository.state(row.id, featureId);
        if (snapshot) {
            return {
                layerId: row.id,
                feature: {
                    ...item,
                    ...snapshot.attributes,
                    geometry: snapshot.geometry,
                    version: Number(current?.version || 1),
                },
            };
        }
    }
    return { layerId: row.id, feature: item };
};
const nearby = async (id, input, actor) => {
    requirePermission(actor, 'map', 'locate');
    return repository.nearby(await getLayer(id, actor), input);
};
const measure = async (input, actor) => {
    requirePermission(actor, 'map', 'measure');
    try {
        return await repository.measure(input.geometry);
    } catch (error) {
        if (error.code?.startsWith('22')) {
            throw new Api422Error('Hình học đo đạc không hợp lệ', ['INVALID_MEASUREMENT_GEOMETRY']);
        }
        throw error;
    }
};
const createDraft = (input, actor) => {
    requirePermission(actor, 'map', 'draw');
    return repository.createDraft(input, actor);
};
const listDrafts = (input, actor) => {
    requirePermission(actor, 'map', 'draw');
    return repository.listDrafts(input, actor);
};
const getDraft = async (id, actor) => {
    requirePermission(actor, 'map', 'draw');
    const row = await repository.findDraft(id, actor);
    if (!row) {
        throw new Api404Error('Không tìm thấy bản phác thảo');
    }
    return row;
};
const removeDraft = async (id, input, actor) => {
    requirePermission(actor, 'map', 'draw');
    const row = await repository.removeDraft(id, input.expectedUpdatedAt, actor);
    if (row) {
        return row;
    }
    if (!(await repository.findDraft(id, actor))) {
        throw new Api404Error('Không tìm thấy bản phác thảo');
    }
    throw new Api409Error('Bản phác thảo đã thay đổi; vui lòng tải lại', [
        'OPTIMISTIC_LOCK_CONFLICT',
    ]);
};
const currentWeather = async (input, actor) => {
    requirePermission(actor, 'weather', 'read');
    if (!weatherConfig.isOpenWeatherConfigured()) {
        throw new Api503Error('Dịch vụ thời tiết chưa được cấu hình', ['WEATHER_UNAVAILABLE']);
    }
    try {
        const data = await weatherClient.getCurrentWeather(input.longitude, input.latitude);
        return {
            observedAt: data.observedAt,
            location: data.location,
            temperatureC: data.temp,
            windSpeedMps: data.wind.speed,
            windDirectionDegrees: data.wind.deg,
            description: data.weather?.description || null,
        };
    } catch {
        throw new Api503Error('Không thể lấy dữ liệu thời tiết lúc này', [
            'WEATHER_UPSTREAM_UNAVAILABLE',
        ]);
    }
};
module.exports = {
    tile,
    feature,
    nearby,
    measure,
    createDraft,
    listDrafts,
    getDraft,
    removeDraft,
    currentWeather,
};
