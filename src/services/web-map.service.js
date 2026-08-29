'use strict';

const repository = require('../repositories/web-map.repository');
const minioService = require('./minio.service');
const { Api403Error, Api404Error, Api422Error } = require('../core/error.response');
const { t } = require('../utils/i18n.util');

const BLOCKED_CATEGORIES = new Set(['flood', 'forest']);

const canMap = (actor, action) => !actor || actor.permissions?.map?.[action] === true;
const assertMap = (actor, action) => {
    if (!canMap(actor, action)) {
        throw new Api403Error(t('web_map_forbidden', actor?.lang));
    }
};
const getAccessible = async (id, actor, options) => {
    const layer = await repository.accessibleLayer(id, actor, options);
    if (!layer) {
        throw new Api404Error(t('web_map_layer_not_found', actor?.lang));
    }
    return layer;
};

const canEditLayer = (layer, actor) =>
    actor?.role === 'so_tnmt' &&
    actor.permissions?.map_feature?.update === true &&
    layer.role_can_edit === true;
const safeEditableFields = (layer, actor) => {
    if (!canEditLayer(layer, actor)) {
        return [];
    }
    const configuredId = layer.metadata?.idField,
        idField =
            typeof configuredId === 'string' && repository.FIELD.test(configuredId)
                ? configuredId
                : layer.metadata?.importType === 'excel'
                  ? 'source_row'
                  : 'source_fid';
    const blocked = new Set([
        'geom',
        'source',
        'target',
        'cost',
        'reverse_cost',
        idField.toLowerCase(),
    ]);
    const fields = Array.isArray(layer.metadata?.editableFields)
        ? layer.metadata.editableFields.filter(
              (field) =>
                  typeof field === 'string' &&
                  repository.FIELD.test(field) &&
                  !blocked.has(field.toLowerCase()),
          )
        : [];
    return [...new Set(fields)].slice(0, 30);
};
const serializeLayer = (layer, actor) => {
    const editableFields = safeEditableFields(layer, actor);
    const timeValues = Array.isArray(layer.time_values) ? layer.time_values : [];
    const isTimeSeries = layer.metadata?.timeSeries?.enabled === true && timeValues.length > 0;
    return {
        id: layer.id,
        code: layer.code,
        nameVi: layer.name_vi,
        category: layer.category,
        categoryName: layer.category_name || null,
        geometryType: layer.geometry_type,
        storageKind: layer.storage_kind,
        srid: layer.srid,
        geoserverLayer: layer.geoserver_layer,
        styleName: layer.style_name,
        minZoom: layer.min_zoom,
        maxZoom: layer.max_zoom,
        legend: layer.legend_config,
        isPublic: layer.is_public,
        isEnableDefault: layer.is_enable_default,
        canEdit: canEditLayer(layer, actor),
        editableFields,
        ...(isTimeSeries
            ? {
                  timeSeries: {
                      enabled: true,
                      mode: 'discrete',
                      defaultTime: timeValues.at(-1),
                      values: timeValues,
                  },
              }
            : {}),
    };
};
const listLayers = async (filter, actor) => {
    assertMap(actor, 'view');
    const { category, search } = filter || {};
    const isAdmin = actor?.role === 'system_admin';
    const layers = await repository.catalog(actor, { category, search });
    const visible = isAdmin ? layers : layers.filter((l) => !BLOCKED_CATEGORIES.has(l.category));
    return visible.map((layer) => serializeLayer(layer, actor));
};
const getFeature = async (layerId, featureId, includeGeometry, actor) => {
    assertMap(actor, 'view_attributes');
    const layer = await getAccessible(layerId, actor);
    if (layer.storage_kind !== 'postgis' || !layer.table_name) {
        throw new Api422Error(t('web_map_not_vector', actor?.lang), ['NOT_VECTOR_LAYER']);
    }
    const feature = await repository.featureById(layer, featureId, includeGeometry);
    if (!feature) {
        throw new Api404Error(t('web_map_feature_not_found', actor?.lang));
    }
    return { layerId: layer.id, feature };
};
const searchFeatures = async ({ q, layerId, bbox, limit }, actor) => {
    assertMap(actor, 'search_feature');
    const layers = layerId
        ? [await getAccessible(layerId, actor)]
        : (await repository.catalog(actor)).filter((layer) => layer.storage_kind === 'postgis');
    const perLayer = Math.max(1, Math.ceil(limit / Math.max(1, layers.length)));
    const results = [];
    for (const layer of layers) {
        if (!layer.table_name || !repository.searchFields(layer).length) {
            continue;
        }
        const features = await repository.searchLayer(layer, q, bbox, perLayer);
        results.push(
            ...features.map((feature) => ({
                layerId: layer.id,
                layerCode: layer.code,
                layerName: layer.name_vi,
                ...feature,
            })),
        );
        if (results.length >= limit) {
            break;
        }
    }
    return results.slice(0, limit);
};
const getLegend = async (layerId, actor) => {
    assertMap(actor, 'view_legend');
    const layer = await getAccessible(layerId, actor);
    return {
        layerId: layer.id,
        code: layer.code,
        nameVi: layer.name_vi,
        styleName: layer.style_name,
        minZoom: layer.min_zoom,
        maxZoom: layer.max_zoom,
        legend: layer.legend_config,
    };
};
const listBasemaps = async (actor) => {
    assertMap(actor, 'view');
    return repository.basemaps();
};
const listTerrain = async (actor) => {
    assertMap(actor, 'view_3d');
    return repository.terrainCatalog(actor);
};
const getTerrainUrl = async (layerId, expireSeconds, actor) => {
    assertMap(actor, 'view_3d');
    const layer = await getAccessible(layerId, actor, { terrain: true });
    return minioService.getPresignedDownloadUrl({
        objectKey: layer.object_key,
        category: 'raster',
        expireSeconds,
    });
};

module.exports = {
    listLayers,
    getFeature,
    searchFeatures,
    getLegend,
    listBasemaps,
    listTerrain,
    getTerrainUrl,
    serializeLayer,
};
