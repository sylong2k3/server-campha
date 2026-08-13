'use strict';

const db = require('../configs/database');

const insertZone = async ({ name, observedAt, classId, source, geom, notes, createdBy }) => {
    const { rows } = await db.query(
        `INSERT INTO forest.forest_gt_zones (name, observed_at, class_id, source, geom, notes, created_by)
         VALUES ($1,$2,$3,$4,ST_GeomFromGeoJSON($5),$6,$7)
         RETURNING id, name, observed_at, class_id, source, area_ha,
                   ST_AsGeoJSON(geom)::jsonb AS geom, notes, created_at`,
        [name || null, observedAt, classId, source || 'field_survey', JSON.stringify(geom), notes || null, createdBy || null],
    );
    return rows[0];
};

const insertZones = async (features, createdBy) => {
    const client = await db.pool.connect();
    const ids = [];
    try {
        await client.query('BEGIN');
        for (const feature of features) {
            const props = feature.properties || {};
            const geom = feature.geometry?.type === 'Polygon'
                ? { type: 'MultiPolygon', coordinates: [feature.geometry.coordinates] }
                : feature.geometry;
            const { rows } = await client.query(
                `INSERT INTO forest.forest_gt_zones (name, observed_at, class_id, source, geom, notes, created_by)
                 VALUES ($1,$2,$3,$4,ST_GeomFromGeoJSON($5),$6,$7) RETURNING id`,
                [
                    props.name || null,
                    props.observedAt || props.observed_at || props.date || new Date(),
                    Number(props.classId ?? props.class_id ?? props.class),
                    props.source || 'field_survey',
                    JSON.stringify(geom),
                    props.notes || null,
                    createdBy || null,
                ],
            );
            ids.push(rows[0].id);
        }
        await client.query('COMMIT');
        return { inserted: ids.length, ids };
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
};

const listZones = async ({ page, limit, from, to, classId }) => {
    const values = [];
    const where = ['is_active = TRUE'];
    if (from) { values.push(from); where.push(`observed_at >= $${values.length}`); }
    if (to) { values.push(to); where.push(`observed_at < $${values.length}`); }
    if (classId !== null) { values.push(classId); where.push(`class_id = $${values.length}`); }
    values.push(limit, (page - 1) * limit);
    const { rows } = await db.query(
        `SELECT id, name, observed_at, class_id, source, area_ha, ST_AsGeoJSON(geom)::jsonb AS geom,
                notes, created_at, COUNT(*) OVER()::int AS total_count
           FROM forest.forest_gt_zones WHERE ${where.join(' AND ')}
          ORDER BY observed_at DESC LIMIT $${values.length - 1} OFFSET $${values.length}`,
        values,
    );
    return { items: rows.map(({ total_count: _totalCount, ...item }) => item), total: Number(rows[0]?.total_count || 0) };
};

const disableZone = async (id) => (await db.query(
    'UPDATE forest.forest_gt_zones SET is_active = FALSE WHERE id = $1 AND is_active = TRUE', [id],
)).rowCount > 0;

const insertPoint = async ({ observedAt, classId, lng, lat, source, photoUrl, reporterName, notes, createdBy }) => {
    const { rows } = await db.query(
        `INSERT INTO forest.forest_gt_points
            (observed_at,class_id,lng,lat,source,photo_url,reporter_name,notes,created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         RETURNING id,observed_at,class_id,lng,lat,source,photo_url,reporter_name,notes,created_at`,
        [observedAt, classId, lng, lat, source || 'field_report', photoUrl || null, reporterName || null, notes || null, createdBy || null],
    );
    return rows[0];
};

const insertPoints = async (points, createdBy) => {
    const client = await db.pool.connect();
    const ids = [];
    try {
        await client.query('BEGIN');
        for (const point of points) {
            const { rows } = await client.query(
                `INSERT INTO forest.forest_gt_points
                    (observed_at,class_id,lng,lat,source,photo_url,reporter_name,notes,created_by)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
                [
                    point.observedAt || point.observed_at,
                    Number(point.classId ?? point.class_id), Number(point.lng), Number(point.lat),
                    point.source || 'field_report', point.photoUrl || point.photo_url || null,
                    point.reporterName || point.reporter_name || null, point.notes || null, createdBy || null,
                ],
            );
            ids.push(rows[0].id);
        }
        await client.query('COMMIT');
        return { inserted: ids.length, ids };
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
};

const listPoints = async ({ page, limit, from, to, classId }) => {
    const values = [];
    const where = ['is_active = TRUE'];
    if (from) { values.push(from); where.push(`observed_at >= $${values.length}`); }
    if (to) { values.push(to); where.push(`observed_at < $${values.length}`); }
    if (classId !== null) { values.push(classId); where.push(`class_id = $${values.length}`); }
    values.push(limit, (page - 1) * limit);
    const { rows } = await db.query(
        `SELECT id,observed_at,class_id,lng,lat,source,photo_url,reporter_name,notes,created_at,
                COUNT(*) OVER()::int AS total_count
           FROM forest.forest_gt_points WHERE ${where.join(' AND ')}
          ORDER BY observed_at DESC LIMIT $${values.length - 1} OFFSET $${values.length}`,
        values,
    );
    return { items: rows.map(({ total_count: _totalCount, ...item }) => item), total: Number(rows[0]?.total_count || 0) };
};

const disablePoint = async (id) => (await db.query(
    'UPDATE forest.forest_gt_points SET is_active = FALSE WHERE id = $1 AND is_active = TRUE', [id],
)).rowCount > 0;

module.exports = { insertZone, insertZones, listZones, disableZone, insertPoint, insertPoints, listPoints, disablePoint };
