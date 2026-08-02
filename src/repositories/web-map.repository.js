'use strict';

const db = require('../configs/database');

const IDENTIFIER = /^[a-z][a-z0-9_]{0,62}$/;
const FIELD = /^[A-Za-z_][A-Za-z0-9_]{0,62}$/;
const qid = (value, pattern = IDENTIFIER) => {
    if (!pattern.test(value)) {
        throw new TypeError('Unsafe database identifier');
    }
    return `"${value}"`;
};
const actorRole = (actor) => actor?.role || null;

const catalog = async (actor, category) => {
    const params = [actorRole(actor)];
    const where = [
        'l.deleted_at IS NULL',
        "l.publish_status = 'published'",
        '(l.is_public = true OR COALESCE(lp.can_view, false) = true)',
    ];
    if (category) {
        params.push(category);
        where.push(`l.category = $${params.length}`);
    }
    const { rows } = await db.query(
        `SELECT l.id, l.code, l.name_vi, l.category, l.geometry_type, l.srid,
                l.storage_kind, l.table_name, l.geoserver_layer, l.style_name,
                l.min_zoom, l.max_zoom, l.legend_config, l.is_public, l.metadata
         FROM gis.layers l
         LEFT JOIN gis.layer_permissions lp ON lp.layer_id = l.id AND lp.role_code = $1
         WHERE ${where.join(' AND ')}
         ORDER BY l.category NULLS LAST, l.name_vi, l.id`,
        params,
    );
    return rows;
};

const accessibleLayer = async (id, actor, { terrain = false } = {}) => {
    const {
        rows: [row],
    } = await db.query(
        `SELECT l.*, COALESCE(lp.can_view, false) AS role_can_view,
                COALESCE(lp.can_edit, false) AS role_can_edit
         FROM gis.layers l
         LEFT JOIN gis.layer_permissions lp ON lp.layer_id = l.id AND lp.role_code = $2
         WHERE l.id = $1 AND l.deleted_at IS NULL
           AND (l.is_public = true OR COALESCE(lp.can_view, false) = true)
           ${terrain ? "AND l.storage_kind = 'geotiff_minio' AND l.object_key IS NOT NULL" : ''}`,
        [id, actorRole(actor)],
    );
    return row || null;
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

const basemaps = async () => {
    const { rows } = await db.query(
        `SELECT code, name_vi, provider, url_template, attribution, min_zoom, max_zoom
         FROM gis.basemaps
         WHERE is_enabled = true AND requires_api_key = false
         ORDER BY display_order, id`,
    );
    return rows;
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
    accessibleLayer,
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
