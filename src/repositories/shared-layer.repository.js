'use strict';
const db = require('../configs/database');
const webMap = require('./web-map.repository');
const edit = require('./mobile-feature-edit.repository');
const q = (value) => webMap.qid(value, webMap.FIELD),
    table = (r) => webMap.qid(r.table_name),
    id = (r) => webMap.qid(webMap.idFieldFor(r), webMap.FIELD);
const selectParts = (r, alias = 't') => {
    const fields = r.read_fields.map((x) => `${alias}.${q(x)}`);
    return [
        `${alias}.${id(r)}::text feature_id`,
        ...fields,
        `COALESCE(s.version,1)::bigint version`,
        `s.updated_at`,
    ];
};
const list = async (r, input) => {
    const p = [],
        where = [];
    if (input.q) {
        p.push(`%${input.q}%`);
        where.push(
            `concat_ws(' ',${r.search_fields.map((x) => `COALESCE(t.${q(x)}::text,'')`).join(',')}) ILIKE $${p.length}`,
        );
    }
    const sort = input.sortBy || r.default_sort_field,
        sortSql = sort === webMap.idFieldFor(r) ? `t.${id(r)}` : `t.${q(sort)}`,
        order = input.sortOrder === 'ASC' ? 'ASC' : 'DESC';
    p.push(input.limit, (input.page - 1) * input.limit);
    const geom = input.includeGeometry
        ? `,ST_AsGeoJSON(ST_Transform(t.geom,4326),6)::jsonb geometry`
        : '';
    const { rows } = await db.query(
        `SELECT ${selectParts(r).join(',')}${geom},COUNT(*) OVER()::int total_count FROM gis.${table(r)} t LEFT JOIN gis.feature_states s ON s.layer_id=$${p.length + 1} AND s.feature_id=t.${id(r)}::text ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY ${sortSql} ${order},t.${id(r)} ${order} LIMIT $${p.length - 1} OFFSET $${p.length}`,
        p.concat(r.layer_id),
    );
    return {
        items: rows.map(({ total_count: _total, ...x }) => x),
        total: rows[0]?.total_count || 0,
    };
};
const get = async (r, featureId, client = db, lock = false) => {
    const geom = `,ST_AsGeoJSON(ST_Transform(t.geom,4326),6)::jsonb geometry`;
    const {
        rows: [row],
    } = await client.query(
        `SELECT ${selectParts(r).join(',')}${geom} FROM gis.${table(r)} t LEFT JOIN gis.feature_states s ON s.layer_id=$2 AND s.feature_id=t.${id(r)}::text WHERE t.${id(r)}::text=$1 ${lock ? 'FOR UPDATE OF t' : ''}`,
        [String(featureId), r.layer_id],
    );
    return row || null;
};
const validateGeometry = async (r, geometry, client) => {
    const {
        rows: [check],
    } = await client.query(
        `WITH g AS(SELECT ST_SetSRID(ST_GeomFromGeoJSON($1::jsonb),4326) geom) SELECT ST_IsValid(geom) valid,ST_IsEmpty(geom) empty,UPPER(GeometryType(geom)) type FROM g`,
        [JSON.stringify(geometry)],
    );
    const expected = String(r.geometry_type).replace('MULTI', '');
    if (!check.valid || check.empty || check.type !== expected) {
        const error = new Error('INVALID_FEATURE_GEOMETRY');
        error.code = 'INVALID_FEATURE_GEOMETRY';
        throw error;
    }
};
const create = async (r, input, actor) => {
    const client = await db.getClient();
    try {
        await client.query('BEGIN');
        await validateGeometry(r, input.geometry, client);
        const fields = Object.keys(input.attributes),
            p = [
                input.featureId,
                ...fields.map((x) => input.attributes[x]),
                JSON.stringify(input.geometry),
                Number(r.srid),
            ];
        const g = `ST_Transform(ST_SetSRID(ST_GeomFromGeoJSON($${p.length - 1}::jsonb),4326),$${p.length}::integer)`;
        await client.query(
            `INSERT INTO gis.${table(r)}(${id(r)}${fields.length ? `,${fields.map(q).join(',')}` : ''},geom) VALUES($1${fields.map((_, i) => `,$${i + 2}`).join('')},${String(r.geometry_type).startsWith('MULTI') ? `ST_Multi(${g})` : g})`,
            p,
        );
        await client.query(
            `INSERT INTO gis.feature_states(layer_id,feature_id,version,updated_by) VALUES($1,$2,1,$3)`,
            [r.layer_id, String(input.featureId), actor.id],
        );
        const after = await get(r, input.featureId, client);
        const attrs = Object.fromEntries(r.read_fields.map((x) => [x, after[x]]));
        await client.query(
            `INSERT INTO apikey.feature_mutations(registry_id,key_id,layer_id,feature_id,version,action,after_attributes,after_geom,actor_user_id) VALUES($1,$2,$3,$4,1,'create',$5,ST_SetSRID(ST_GeomFromGeoJSON($6::jsonb),4326),$7)`,
            [
                r.registry_id,
                r.api_key_id,
                r.layer_id,
                String(input.featureId),
                attrs,
                JSON.stringify(after.geometry),
                actor.id,
            ],
        );
        await client.query('COMMIT');
        return after;
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
};
const update = async (r, featureId, input, actor) =>
    edit.updateTx(r, featureId, input, actor, { apiKeyId: r.api_key_id });
const remove = async (r, featureId, baseVersion, actor) => {
    const client = await db.getClient();
    try {
        await client.query('BEGIN');
        const before = await get(r, featureId, client, true);
        if (!before) {
            await client.query('ROLLBACK');
            return { missing: true };
        }
        let version = Number(before.version);
        const {
            rows: [state],
        } = await client.query(
            `SELECT version FROM gis.feature_states WHERE layer_id=$1 AND feature_id=$2 FOR UPDATE`,
            [r.layer_id, String(featureId)],
        );
        if (!state) {
            await client.query(
                `INSERT INTO gis.feature_states(layer_id,feature_id,version,updated_by) VALUES($1,$2,1,$3)`,
                [r.layer_id, String(featureId), actor.id],
            );
            version = 1;
        } else {
            version = Number(state.version);
        }
        if (version !== Number(baseVersion)) {
            await client.query('ROLLBACK');
            return { conflict: true, current: { ...before, version } };
        }
        const attrs = Object.fromEntries(r.read_fields.map((x) => [x, before[x]])),
            next = version + 1;
        await client.query(`DELETE FROM gis.${table(r)} WHERE ${id(r)}::text=$1`, [
            String(featureId),
        ]);
        await client.query(
            `UPDATE gis.feature_states SET version=$3,updated_by=$4,updated_at=NOW() WHERE layer_id=$1 AND feature_id=$2`,
            [r.layer_id, String(featureId), next, actor.id],
        );
        await client.query(
            `INSERT INTO apikey.feature_mutations(registry_id,key_id,layer_id,feature_id,version,action,before_attributes,before_geom,actor_user_id) VALUES($1,$2,$3,$4,$5,'delete',$6,ST_SetSRID(ST_GeomFromGeoJSON($7::jsonb),4326),$8)`,
            [
                r.registry_id,
                r.api_key_id,
                r.layer_id,
                String(featureId),
                next,
                attrs,
                JSON.stringify(before.geometry),
                actor.id,
            ],
        );
        await client.query('COMMIT');
        return { featureId: String(featureId), version: next, deleted: true };
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
};
module.exports = { list, get, create, update, remove, validateGeometry };
