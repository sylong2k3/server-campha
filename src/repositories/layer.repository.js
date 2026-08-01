'use strict';

const db = require('../configs/database');
const { versionCondition } = require('../utils/optimistic-lock.util');

const SORT_COLUMNS = Object.freeze({
    created_at: 'l.created_at',
    updated_at: 'l.updated_at',
    name_vi: 'l.name_vi',
    code: 'l.code',
    category: 'l.category',
});

const list = async (filter) => {
    const params = [];
    const where = ['l.deleted_at IS NULL'];
    if (filter.q) {
        params.push(`%${filter.q}%`);
        where.push(`(l.name_vi ILIKE $${params.length} OR l.code ILIKE $${params.length})`);
    }
    if (filter.category) { params.push(filter.category); where.push(`l.category = $${params.length}`); }
    if (filter.geometryType) { params.push(filter.geometryType); where.push(`l.geometry_type = $${params.length}`); }
    if (filter.isPublic !== undefined) { params.push(filter.isPublic); where.push(`l.is_public = $${params.length}`); }
    const sort = SORT_COLUMNS[filter.sortBy] || SORT_COLUMNS.updated_at;
    const order = filter.sortOrder === 'ASC' ? 'ASC' : 'DESC';
    params.push(filter.limit, (filter.page - 1) * filter.limit);
    const { rows } = await db.query(
        `SELECT l.*, COUNT(*) OVER()::int AS total_count
         FROM gis.layers l
         WHERE ${where.join(' AND ')}
         ORDER BY ${sort} ${order}, l.id ${order}
         LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params
    );
    const total = rows[0]?.total_count || 0;
    return { items: rows.map(({ total_count: _totalCount, ...row }) => row), total };
};

const findById = async (id, includeDeleted = false, client = db) => {
    const { rows: [row] } = await client.query(
        `SELECT l.*,
                COALESCE(
                    jsonb_agg(jsonb_build_object(
                        'roleCode', lp.role_code,
                        'canView', lp.can_view,
                        'canExport', lp.can_export,
                        'canEdit', lp.can_edit,
                        'canDelete', lp.can_delete
                    ) ORDER BY lp.role_code) FILTER (WHERE lp.role_code IS NOT NULL),
                    '[]'::jsonb
                ) AS permissions
         FROM gis.layers l
         LEFT JOIN gis.layer_permissions lp ON lp.layer_id = l.id
         WHERE l.id = $1 ${includeDeleted ? '' : 'AND l.deleted_at IS NULL'}
         GROUP BY l.id`,
        [id]
    );
    return row || null;
};

const updateMetadata = async (id, payload) => {
    const fields = {
        nameVi: 'name_vi', category: 'category', styleName: 'style_name',
        minZoom: 'min_zoom', maxZoom: 'max_zoom', legendConfig: 'legend_config',
        metadata: 'metadata', isPublic: 'is_public',
    };
    const params = [];
    const assignments = [];
    for (const [key, column] of Object.entries(fields)) {
        if (Object.prototype.hasOwnProperty.call(payload, key)) {
            params.push(payload[key]);
            assignments.push(`${column} = $${params.length}`);
        }
    }
    params.push(id, payload.expectedUpdatedAt);
    const { rows: [row] } = await db.query(
        `UPDATE gis.layers
         SET ${assignments.join(', ')}, version = version + 1
         WHERE id = $${params.length - 1} AND deleted_at IS NULL${versionCondition(params.length)}
         RETURNING *`,
        params
    );
    return row || null;
};

const activeRoleCodes = async (codes) => {
    const { rows } = await db.query(
        'SELECT code FROM auth.roles WHERE is_active = true AND code = ANY($1::varchar[])',
        [codes]
    );
    return rows.map((row) => row.code);
};

const replacePermissions = async (layerId, permissions) => {
    const client = await db.getClient();
    try {
        await client.query('BEGIN');
        const exists = await client.query('SELECT id FROM gis.layers WHERE id = $1 AND deleted_at IS NULL FOR UPDATE', [layerId]);
        if (!exists.rowCount) { await client.query('ROLLBACK'); return null; }
        await client.query('DELETE FROM gis.layer_permissions WHERE layer_id = $1', [layerId]);
        for (const item of permissions) {
            await client.query(
                `INSERT INTO gis.layer_permissions
                    (layer_id, role_code, can_view, can_export, can_edit, can_delete)
                 VALUES ($1, $2, $3, $4, $5, $6)`,
                [layerId, item.roleCode, item.canView, item.canExport, item.canEdit, item.canDelete]
            );
        }
        const { rows: [version] } = await client.query(
            'UPDATE gis.layers SET version = version + 1 WHERE id = $1 RETURNING updated_at, version',
            [layerId]
        );
        const layer = await findById(layerId, false, client);
        layer.updated_at = version.updated_at;
        layer.version = version.version;
        await client.query('COMMIT');
        return layer;
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally { client.release(); }
};

const softDeleteAndEnqueue = async (id, expectedUpdatedAt) => {
    const client = await db.getClient();
    try {
        await client.query('BEGIN');
        const { rows: [deleted] } = await client.query(
            `UPDATE gis.layers
             SET deleted_at = NOW(), cleanup_status = 'queued', publish_status = 'unpublished', version = version + 1
             WHERE id = $1 AND deleted_at IS NULL${versionCondition(2)}
             RETURNING *`,
            [id, expectedUpdatedAt]
        );
        if (!deleted) { await client.query('ROLLBACK'); return null; }
        await client.query(
            `INSERT INTO gis.layer_cleanup_jobs (layer_id) VALUES ($1)
             ON CONFLICT (layer_id) WHERE status IN ('queued', 'running') DO NOTHING`,
            [id]
        );
        await client.query('COMMIT');
        return deleted;
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally { client.release(); }
};

const setPublishState = async (id, publishStatus, geoserverLayer = null) => {
    const { rows: [row] } = await db.query(
        `UPDATE gis.layers
         SET publish_status = $2, geoserver_layer = COALESCE($3, geoserver_layer), version = version + 1
         WHERE id = $1 AND deleted_at IS NULL RETURNING *`,
        [id, publishStatus, geoserverLayer]
    );
    return row || null;
};

module.exports = {
    list, findById, updateMetadata, activeRoleCodes, replacePermissions,
    softDeleteAndEnqueue, setPublishState,
};
