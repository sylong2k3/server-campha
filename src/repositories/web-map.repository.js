'use strict';

const db = require('../configs/database');

const IDENTIFIER = /^[a-z][a-z0-9_]{0,62}$/;
const FIELD = /^[A-Za-z_][A-Za-z0-9_]{0,62}$/;
const ACCESSIBLE_LAYER_CACHE_TTL_MS = 5_000;
const ACCESSIBLE_LAYER_CACHE_MAX = 500;
const accessibleLayerCache = new Map();
const accessibleLayerQueries = new Map();
const qid = (value, pattern = IDENTIFIER) => {
    if (!pattern.test(value)) {
        throw new TypeError('Unsafe database identifier');
    }
    return `"${value}"`;
};
const actorRole = (actor) => actor?.role || null;

const catalog = async (actor, { category, search } = {}) => {
    const params = [actorRole(actor)];
    const where = [
        'l.deleted_at IS NULL',
        "l.publish_status = 'published'",
        '(l.is_public = true OR COALESCE(lp.can_view, false) = true)',
        "COALESCE(l.metadata->'timeSeries'->>'enabled', 'false') <> 'true'",
    ];
    if (category) {
        params.push(category);
        where.push(`l.category = $${params.length}`);
    }
    if (search) {
        params.push(`%${search}%`);
        const term = `unaccent($${params.length})`;
        where.push(
            `(unaccent(l.name_vi) ILIKE ${term}
              OR l.code ILIKE $${params.length}
              OR unaccent(COALESCE(l.category_name, '')) ILIKE ${term})`,
        );
    }
    const { rows } = await db.query(
        `SELECT l.id, l.code, l.name_vi, l.category, l.category_name, l.geometry_type, l.srid,
                l.storage_kind, l.table_name, l.geoserver_layer, l.style_name,
                l.min_zoom, l.max_zoom, l.legend_config, l.is_public, l.is_enable_default, l.metadata,
                COALESCE(lp.can_edit, false) AS role_can_edit,
                (SELECT array_agg(to_char(times.acquired_at AT TIME ZONE 'UTC',
                                          'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') ORDER BY times.acquired_at,times.id)
                 FROM raster.satellite_images times
                 WHERE times.layer_id=l.id AND times.deleted_at IS NULL) AS time_values,
                (SELECT json_agg(json_build_object(
                            'imageId', times.id,
                            'sceneCode', times.scene_code,
                            'acquiredAt', to_char(times.acquired_at AT TIME ZONE 'UTC',
                                                   'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
                            'fileObjectId', times.file_object_id
                        ) ORDER BY times.acquired_at,times.id)
                 FROM raster.satellite_images times
                 WHERE times.layer_id=l.id AND times.deleted_at IS NULL) AS time_series_members
         FROM gis.layers l
         LEFT JOIN gis.layer_permissions lp ON lp.layer_id = l.id AND lp.role_code = $1
         WHERE ${where.join(' AND ')}
         ORDER BY l.category NULLS LAST, l.name_vi, l.id`,
        params,
    );
    return rows;
};

const timeSeriesCatalog = async (actor) => {
    const { rows } = await db.query(
        `SELECT l.id, l.code, l.name_vi, l.category, l.category_name, l.geometry_type, l.srid,
                l.storage_kind, l.table_name, l.geoserver_layer, l.style_name,
                l.min_zoom, l.max_zoom, l.legend_config, l.is_public, l.is_enable_default, l.metadata,
                false AS role_can_edit,
                (SELECT array_agg(to_char(times.acquired_at AT TIME ZONE 'UTC',
                                          'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') ORDER BY times.acquired_at,times.id)
                 FROM raster.satellite_images times
                 WHERE times.layer_id=l.id AND times.deleted_at IS NULL) AS time_values,
                (SELECT json_agg(json_build_object(
                            'imageId', times.id,
                            'sceneCode', times.scene_code,
                            'acquiredAt', to_char(times.acquired_at AT TIME ZONE 'UTC',
                                                   'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
                            'fileObjectId', times.file_object_id
                        ) ORDER BY times.acquired_at,times.id)
                 FROM raster.satellite_images times
                 WHERE times.layer_id=l.id AND times.deleted_at IS NULL) AS time_series_members
         FROM gis.layers l
         LEFT JOIN gis.layer_permissions lp ON lp.layer_id = l.id AND lp.role_code = $1
         WHERE l.deleted_at IS NULL AND l.publish_status = 'published'
           AND (l.is_public = true OR COALESCE(lp.can_view, false) = true)
           AND l.metadata->'timeSeries'->>'enabled' = 'true'
         ORDER BY l.name_vi, l.id`,
        [actorRole(actor)],
    );
    return rows;
};

const accessibleLayer = async (id, actor, { terrain = false } = {}) => {
    const role = actorRole(actor) || '';
    const key = `${id}:${role}:${terrain ? 'terrain' : 'map'}`;
    const now = Date.now();
    const cached = accessibleLayerCache.get(key);
    if (cached && cached.expiresAt > now) {
        return cached.value;
    }
    if (accessibleLayerQueries.has(key)) {
        return accessibleLayerQueries.get(key);
    }
    const pending = db
        .query(
            `SELECT l.*, COALESCE(lp.can_view, false) AS role_can_view,
                    COALESCE(lp.can_edit, false) AS role_can_edit,
                    (SELECT array_agg(to_char(times.acquired_at AT TIME ZONE 'UTC',
                                              'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') ORDER BY times.acquired_at,times.id)
                     FROM raster.satellite_images times
                     WHERE times.layer_id=l.id AND times.deleted_at IS NULL) AS time_values,
                    (SELECT json_agg(json_build_object(
                                'imageId', times.id,
                                'sceneCode', times.scene_code,
                                'acquiredAt', to_char(times.acquired_at AT TIME ZONE 'UTC',
                                                       'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
                                'fileObjectId', times.file_object_id
                            ) ORDER BY times.acquired_at,times.id)
                     FROM raster.satellite_images times
                     WHERE times.layer_id=l.id AND times.deleted_at IS NULL) AS time_series_members
             FROM gis.layers l
             LEFT JOIN gis.layer_permissions lp ON lp.layer_id = l.id AND lp.role_code = $2
             WHERE l.id = $1 AND l.deleted_at IS NULL
               AND (l.is_public = true OR COALESCE(lp.can_view, false) = true)
               ${terrain ? "AND l.storage_kind = 'geotiff_minio' AND l.object_key IS NOT NULL" : ''}`,
            [id, role || null],
        )
        .then(({ rows: [row] }) => {
            const value = row || null;
            if (accessibleLayerCache.size >= ACCESSIBLE_LAYER_CACHE_MAX) {
                accessibleLayerCache.delete(accessibleLayerCache.keys().next().value);
            }
            accessibleLayerCache.set(key, {
                value,
                expiresAt: Date.now() + ACCESSIBLE_LAYER_CACHE_TTL_MS,
            });
            return value;
        })
        .finally(() => accessibleLayerQueries.delete(key));
    accessibleLayerQueries.set(key, pending);
    return pending;
};
const invalidateLayerCache = (id) => {
    const prefix = `${id}:`;
    for (const key of accessibleLayerCache.keys()) {
        if (key.startsWith(prefix)) {
            accessibleLayerCache.delete(key);
        }
    }
};

const safeField = (field) =>
    typeof field === 'string' && FIELD.test(field) && field.toLowerCase() !== 'geom';
const idFieldFor = (layer) =>
    safeField(layer.metadata?.idField)
        ? layer.metadata.idField
        : layer.metadata?.importType === 'excel'
          ? 'source_row'
          : 'source_fid';
const configuredFields = (layer) => {
    const requested = Array.isArray(layer.metadata?.displayFields)
        ? layer.metadata.displayFields
        : [];
    const fields = requested.filter(safeField);
    return [...new Set(fields)].slice(0, 50);
};
const searchFields = (layer) => {
    const requested = Array.isArray(layer.metadata?.searchFields)
        ? layer.metadata.searchFields
        : [];
    return [...new Set(requested.filter(safeField))].slice(0, 10);
};

const featureById = async (layer, featureId, includeGeometry) => {
    const table = qid(layer.table_name);
    const idField = idFieldFor(layer);
    const fields = configuredFields(layer);
    if (!fields.length) {
        return null;
    }
    const select = [qid(idField, FIELD), ...fields.map((field) => qid(field, FIELD))];
    if (includeGeometry) {
        select.push('ST_AsGeoJSON(ST_Transform(geom, 4326), 6)::jsonb AS geometry');
    }
    const {
        rows: [row],
    } = await db.query(
        `SELECT ${select.join(', ')} FROM gis.${table} WHERE ${qid(idField, FIELD)}::text = $1 LIMIT 1`,
        [String(featureId)],
    );
    return row || null;
};

const searchLayer = async (layer, term, bbox, limit) => {
    const fields = searchFields(layer);
    if (!fields.length) {
        return [];
    }
    const table = qid(layer.table_name);
    const idField = idFieldFor(layer);
    const labels = fields.map((field) => `COALESCE(${qid(field, FIELD)}::text, '')`);
    const combined = `concat_ws(' ', ${labels.join(', ')})`;
    const params = [term];
    let spatial = '';
    if (bbox) {
        const values = bbox.split(',').map(Number);
        params.push(...values);
        spatial = ` AND ST_Intersects(geom, ST_Transform(ST_MakeEnvelope($2, $3, $4, $5, 4326), ST_SRID(geom)))`;
    }
    params.push(limit);
    const limitParam = params.length;
    const { rows } = await db.query(
        `SELECT ${qid(idField, FIELD)} AS feature_id,
                ${qid(fields[0], FIELD)}::text AS label,
                ST_AsGeoJSON(ST_Transform(ST_PointOnSurface(geom), 4326), 6)::jsonb AS location
         FROM gis.${table}
         WHERE unaccent(LOWER(${combined})) % unaccent(LOWER($1))${spatial}
         ORDER BY similarity(unaccent(LOWER(${combined})), unaccent(LOWER($1))) DESC,
                  ${qid(idField, FIELD)}
         LIMIT $${limitParam}`,
        params,
    );
    return rows;
};

const BASEMAP_CACHE_TTL_MS = 60_000;
let basemapCache = null;
let basemapCacheExpiresAt = 0;
let basemapQuery = null;

const basemaps = async () => {
    const now = Date.now();
    if (basemapCache && now < basemapCacheExpiresAt) {
        return basemapCache;
    }
    if (!basemapQuery) {
        basemapQuery = db
            .query(
                `SELECT code, name_vi, provider, url_template, attribution, min_zoom, max_zoom
                 FROM gis.basemaps
                 WHERE is_enabled = true AND requires_api_key = false
                 ORDER BY display_order, id`,
            )
            .then(({ rows }) => {
                basemapCache = rows;
                basemapCacheExpiresAt = Date.now() + BASEMAP_CACHE_TTL_MS;
                return rows;
            })
            .finally(() => {
                basemapQuery = null;
            });
    }
    return basemapQuery;
};

const terrainCatalog = async (actor) => {
    const { rows } = await db.query(
        `SELECT l.id, l.code, l.name_vi, l.srid, l.min_zoom, l.max_zoom, l.metadata, l.is_public
         FROM gis.layers l
         LEFT JOIN gis.layer_permissions lp ON lp.layer_id = l.id AND lp.role_code = $1
         WHERE l.deleted_at IS NULL AND l.storage_kind = 'geotiff_minio' AND l.object_key IS NOT NULL
           AND (l.is_public = true OR COALESCE(lp.can_view, false) = true)
         ORDER BY l.name_vi, l.id`,
        [actorRole(actor)],
    );
    return rows;
};

module.exports = {
    catalog,
    timeSeriesCatalog,
    accessibleLayer,
    invalidateLayerCache,
    configuredFields,
    searchFields,
    idFieldFor,
    featureById,
    searchLayer,
    basemaps,
    terrainCatalog,
    qid,
    FIELD,
};
