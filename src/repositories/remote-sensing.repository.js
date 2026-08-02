'use strict';

const db = require('../configs/database');
const { versionCondition } = require('../utils/optimistic-lock.util');
const pageResult = (rows) => ({
    items: rows.map(({ total_count: _total, ...row }) => row),
    total: rows[0]?.total_count || 0,
});
const selectFields = `s.id,s.scene_code,s.title,s.platform,s.thematic_group,s.coverage_key,s.acquired_at,
    s.product_level,s.resolution_m,s.cloud_cover_percent,s.orbit_number,s.description,
    f.original_name,f.size_bytes,s.created_at,s.updated_at`;

const list = async (filter) => {
    const params = [];
    const where = ['s.deleted_at IS NULL', "f.lifecycle_status='ready'"];
    const add = (value, sql) => {
        if (value !== undefined) {
            params.push(value);
            where.push(sql.replace('?', `$${params.length}`));
        }
    };
    if (filter.q) {
        params.push(`%${filter.q}%`);
        where.push(
            `(unaccent(lower(s.title)) ILIKE unaccent(lower($${params.length})) OR unaccent(lower(s.scene_code)) ILIKE unaccent(lower($${params.length})))`,
        );
    }
    add(filter.platform, 's.platform=?');
    add(filter.thematicGroup, 's.thematic_group=?');
    add(filter.from, 's.acquired_at>=?::timestamptz');
    add(filter.to, 's.acquired_at<=?::timestamptz');
    params.push(filter.limit, (filter.page - 1) * filter.limit);
    const direction = filter.sort === 'acquiredAt:asc' ? 'ASC' : 'DESC';
    const { rows } = await db.query(
        `SELECT ${selectFields},COUNT(*) OVER()::int total_count
        FROM raster.satellite_images s JOIN core.file_objects f ON f.id=s.file_object_id
        WHERE ${where.join(' AND ')} ORDER BY s.acquired_at ${direction},s.id ${direction}
        LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params,
    );
    return pageResult(rows);
};
const find = async (id, includeObject = false) => {
    const internal = includeObject ? ',f.object_key' : '';
    const {
        rows: [row],
    } = await db.query(
        `SELECT ${selectFields}${internal}
        FROM raster.satellite_images s JOIN core.file_objects f ON f.id=s.file_object_id
        WHERE s.id=$1 AND s.deleted_at IS NULL AND f.lifecycle_status='ready'`,
        [id],
    );
    return row || null;
};
const create = async (input, actorId) => {
    const {
        rows: [row],
    } = await db.query(
        `INSERT INTO raster.satellite_images
        (scene_code,title,platform,thematic_group,coverage_key,acquired_at,product_level,resolution_m,
         cloud_cover_percent,orbit_number,description,file_object_id,created_by,updated_by)
        SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,f.id,$13,$13 FROM core.file_objects f
        WHERE f.id=$12 AND f.owner_user_id=$13 AND f.category='raster' AND f.lifecycle_status='ready'
          AND f.scan_status='clean' AND f.detected_mime='image/tiff' AND lower(f.original_name) ~ '\\.(tif|tiff)$'
        RETURNING *`,
        [
            input.sceneCode,
            input.title,
            input.platform,
            input.thematicGroup || null,
            input.coverageKey,
            input.acquiredAt,
            input.productLevel || null,
            input.resolutionM || null,
            input.cloudCoverPercent ?? null,
            input.orbitNumber || null,
            input.description || null,
            input.fileObjectId,
            actorId,
        ],
    );
    return row || null;
};
const categorize = async (id, thematicGroup, expectedUpdatedAt, actorId) => {
    const version = versionCondition(4, 's.updated_at');
    const {
        rows: [row],
    } = await db.query(
        `UPDATE raster.satellite_images s
        SET thematic_group=$2,updated_by=$3 WHERE s.id=$1 AND s.deleted_at IS NULL${version} RETURNING s.*`,
        [id, thematicGroup, actorId, expectedUpdatedAt],
    );
    return row || null;
};
const remove = async (id, expectedUpdatedAt) => {
    const version = versionCondition(2, 's.updated_at');
    const {
        rows: [row],
    } = await db.query(
        `UPDATE raster.satellite_images s SET deleted_at=NOW()
        WHERE s.id=$1 AND s.deleted_at IS NULL${version} RETURNING s.id`,
        [id, expectedUpdatedAt],
    );
    return row || null;
};
module.exports = { list, find, create, categorize, remove };
