'use strict';
const db = require('../configs/database');
const webMapRepository = require('./web-map.repository');
const { versionCondition } = require('../utils/optimistic-lock.util');
const draftFields = `id,title,properties,ST_AsGeoJSON(geom,6)::jsonb geometry,created_at,updated_at`;
const vectorTile = async (layer, z, x, y) => {
    const table = webMapRepository.qid(layer.table_name),
        idField = webMapRepository.idFieldFor(layer),
        fields = webMapRepository.configuredFields(layer),
        select = [
            `${webMapRepository.qid(idField, webMapRepository.FIELD)}::text AS feature_id`,
            ...fields.map((field) => webMapRepository.qid(field, webMapRepository.FIELD)),
        ];
    const {
        rows: [row],
    } = await db.query(
        `WITH bounds AS(
            SELECT ST_TileEnvelope($1,$2,$3) mercator,
                   ST_Transform(ST_TileEnvelope($1,$2,$3),$5::integer) native
         ),mvtgeom AS(
            SELECT ${select.join(',')},ST_AsMVTGeom(ST_Transform(t.geom,3857),bounds.mercator,4096,64,true) geom
            FROM gis.${table} t,bounds
            WHERE t.geom IS NOT NULL
              AND t.geom && bounds.native
              AND ST_Intersects(ST_Transform(t.geom,3857),bounds.mercator)
            LIMIT 5000
         ) SELECT ST_AsMVT(mvtgeom,$4,4096,'geom') tile FROM mvtgeom`,
        [z, x, y, layer.code, Number(layer.srid)],
    );
    return row?.tile || Buffer.alloc(0);
};
const nearby = async (layer, input) => {
    const table = webMapRepository.qid(layer.table_name),
        idField = webMapRepository.idFieldFor(layer),
        fields = webMapRepository.configuredFields(layer),
        select = [
            `${webMapRepository.qid(idField, webMapRepository.FIELD)}::text feature_id`,
            ...fields.map((field) => webMapRepository.qid(field, webMapRepository.FIELD)),
            `ROUND(ST_Distance(ST_Transform(t.geom,5899),ST_Transform(ST_SetSRID(ST_MakePoint($1,$2),4326),5899))::numeric,2) distance_m`,
            `ST_AsGeoJSON(ST_Transform(ST_PointOnSurface(t.geom),4326),6)::jsonb location`,
        ];
    const { rows } = await db.query(
        `WITH point AS(
            SELECT ST_Transform(ST_SetSRID(ST_MakePoint($1,$2),4326),5899) metric
         ),target AS(
            SELECT metric,
                   ST_Transform(ST_Envelope(ST_Buffer(metric,$3)),$5::integer) native_envelope
            FROM point
         ) SELECT ${select.join(',')}
         FROM gis.${table} t,target
         WHERE t.geom IS NOT NULL
           AND t.geom && target.native_envelope
           AND ST_DWithin(ST_Transform(t.geom,5899),target.metric,$3)
         ORDER BY distance_m,${webMapRepository.qid(idField, webMapRepository.FIELD)} LIMIT $4`,
        [input.longitude, input.latitude, input.radiusMeters, input.limit, Number(layer.srid)],
    );
    return rows;
};
const measure = async (geometry) => {
    const {
        rows: [row],
    } = await db.query(
        `WITH g AS(SELECT ST_SetSRID(ST_GeomFromGeoJSON($1::jsonb),4326) geom) SELECT GeometryType(geom) geometry_type,CASE WHEN GeometryType(geom)='LINESTRING' THEN ROUND(ST_Length(ST_Transform(geom,5899))::numeric,2) END length_m,CASE WHEN GeometryType(geom)='POLYGON' THEN ROUND(ST_Area(ST_Transform(geom,5899))::numeric,2) END area_m2 FROM g`,
        [JSON.stringify(geometry)],
    );
    return row;
};
const createDraft = async (input, actor) => {
    const {
        rows: [row],
    } = await db.query(
        `INSERT INTO gis.mobile_drafts(owner_user_id,org_id,title,properties,geom) VALUES($1,$2,$3,$4,ST_SetSRID(ST_GeomFromGeoJSON($5::jsonb),4326)) RETURNING ${draftFields}`,
        [
            actor.id,
            actor.orgId || null,
            input.title,
            input.properties,
            JSON.stringify(input.geometry),
        ],
    );
    return row;
};
const listDrafts = async (input, actor) => {
    const offset = (input.page - 1) * input.limit;
    const { rows } = await db.query(
        `SELECT ${draftFields},COUNT(*) OVER()::int total FROM gis.mobile_drafts WHERE owner_user_id=$1 AND deleted_at IS NULL ORDER BY updated_at DESC,id DESC LIMIT $2 OFFSET $3`,
        [actor.id, input.limit, offset],
    );
    return {
        items: rows.map((row) => {
            const item = { ...row };
            delete item.total;
            return item;
        }),
        total: rows[0]?.total || 0,
    };
};
const findDraft = async (id, actor) => {
    const {
        rows: [row],
    } = await db.query(
        `SELECT ${draftFields} FROM gis.mobile_drafts WHERE id=$1 AND owner_user_id=$2 AND deleted_at IS NULL`,
        [id, actor.id],
    );
    return row || null;
};
const removeDraft = async (id, expectedUpdatedAt, actor) => {
    const version = versionCondition(3, 'updated_at');
    const {
        rows: [row],
    } = await db.query(
        `UPDATE gis.mobile_drafts SET deleted_at=NOW() WHERE id=$1 AND owner_user_id=$2 AND deleted_at IS NULL${version} RETURNING id`,
        [id, actor.id, expectedUpdatedAt],
    );
    return row || null;
};
module.exports = { vectorTile, nearby, measure, createDraft, listDrafts, findDraft, removeDraft };
