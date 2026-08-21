'use strict';

const db = require('../configs/database');
const fileCleanupRepository = require('./file-cleanup.repository');
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
    const keyword = filter.search || filter.q;
    if (keyword) {
        params.push(`%${keyword}%`);
        const term = `unaccent($${params.length})`;
        where.push(
            `(unaccent(l.name_vi) ILIKE ${term}
              OR l.code ILIKE $${params.length}
              OR unaccent(COALESCE(l.category_name, '')) ILIKE ${term})`,
        );
    }
    if (filter.category) {
        params.push(filter.category);
        where.push(`l.category = $${params.length}`);
    }
    if (filter.geometryType) {
        params.push(filter.geometryType);
        where.push(`l.geometry_type = $${params.length}`);
    }
    if (filter.isPublic !== undefined) {
        params.push(filter.isPublic);
        where.push(`l.is_public = $${params.length}`);
    }
    const sort = SORT_COLUMNS[filter.sortBy] || SORT_COLUMNS.updated_at;
    const order = filter.sortOrder === 'ASC' ? 'ASC' : 'DESC';
    params.push(filter.limit, (filter.page - 1) * filter.limit);
    const { rows } = await db.query(
        `SELECT l.*, COUNT(*) OVER()::int AS total_count
         FROM gis.layers l
         WHERE ${where.join(' AND ')}
         ORDER BY ${sort} ${order}, l.id ${order}
         LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params,
    );
    const total = rows[0]?.total_count || 0;
    return { items: rows.map(({ total_count: _totalCount, ...row }) => row), total };
};

const findById = async (id, includeDeleted = false, client = db) => {
    const {
        rows: [row],
    } = await client.query(
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
        [id],
    );
    return row || null;
};

const findByCode = async (code, client = db) => {
    const { rows } = await client.query(
        'SELECT * FROM gis.layers WHERE code = $1 AND deleted_at IS NULL',
        [code],
    );
    return rows[0] || null;
};

const upsertLayerByCode = async (client, payload) => {
    const code = String(payload.code || '').replace(/[^a-z0-9_]/g, '_');
    const tableName = String(payload.table_name || code).replace(/[^a-z0-9_]/g, '_');
    const { rows } = await client.query(
        `INSERT INTO gis.layers (
            code, name_vi, category, geometry_type, srid, storage_kind,
            table_name, object_key, is_public, created_by, publish_status, metadata
         ) VALUES ($1, $2, $3, 'RASTER', $4, 'geotiff_minio', $5, $6, $7, $8, 'published', $9::jsonb)
         ON CONFLICT (code) DO UPDATE SET
            name_vi = EXCLUDED.name_vi,
            category = EXCLUDED.category,
            geometry_type = 'RASTER',
            srid = EXCLUDED.srid,
            storage_kind = 'geotiff_minio',
            table_name = EXCLUDED.table_name,
            object_key = EXCLUDED.object_key,
            is_public = EXCLUDED.is_public,
            publish_status = 'published',
            metadata = COALESCE(gis.layers.metadata, '{}'::jsonb) || EXCLUDED.metadata,
            deleted_at = NULL,
            version = gis.layers.version + 1
         RETURNING *`,
        [
            code,
            payload.name_vi || code,
            payload.category || 'flood',
            payload.epsg_code || 32648,
            tableName,
            payload.object_key || null,
            Boolean(payload.is_public),
            payload.userId || null,
            JSON.stringify(payload.metadata || {}),
        ],
    );
    return rows[0];
};

const updatePublishedMetadata = async (client, id, patch) => {
    const { rows } = await client.query(
        `UPDATE gis.layers
            SET geoserver_layer = $2,
                style_name = COALESCE($3, style_name),
                publish_status = 'published',
                metadata = COALESCE(metadata, '{}'::jsonb) || $4::jsonb,
                version = version + 1
          WHERE id = $1
          RETURNING *`,
        [
            id,
            patch.geoserverLayer,
            patch.styleName || null,
            JSON.stringify({
                geoserverStore: patch.geoserverStore,
                rasterIngestJobId: patch.rasterIngestJobId,
                rasterGeeMetadata: patch.rasterGeeMetadata,
            }),
        ],
    );
    return rows[0] || null;
};

const updateMetadata = async (id, payload) => {
    const fields = {
        nameVi: 'name_vi',
        category: 'category',
        categoryName: 'category_name',
        styleName: 'style_name',
        minZoom: 'min_zoom',
        maxZoom: 'max_zoom',
        legendConfig: 'legend_config',
        metadata: 'metadata',
        isPublic: 'is_public',
        isEnableDefault: 'is_enable_default',
    };
    const params = [];
    const assignments = [];
    for (const [key, column] of Object.entries(fields)) {
        if (Object.prototype.hasOwnProperty.call(payload, key)) {
            params.push(payload[key]);
            assignments.push(
                key === 'metadata'
                    ? `${column} = COALESCE(${column},'{}'::jsonb) || $${params.length}::jsonb`
                    : `${column} = $${params.length}`,
            );
        }
    }
    params.push(id, payload.expectedUpdatedAt);
    const {
        rows: [row],
    } = await db.query(
        `UPDATE gis.layers
         SET ${assignments.join(', ')}, version = version + 1
         WHERE id = $${params.length - 1} AND deleted_at IS NULL${versionCondition(params.length)}
         RETURNING *`,
        params,
    );
    return row || null;
};

const updateStandardMetadata = async (id, profile, expectedUpdatedAt) => {
    const {
        rows: [row],
    } = await db.query(
        `UPDATE gis.layers
         SET metadata = jsonb_set(COALESCE(metadata,'{}'::jsonb), '{standardProfile}', $2::jsonb, true),
             version = version + 1
         WHERE id = $1 AND deleted_at IS NULL${versionCondition(3)}
         RETURNING *`,
        [id, JSON.stringify(profile), expectedUpdatedAt],
    );
    return row || null;
};

const activeRoleCodes = async (codes) => {
    const { rows } = await db.query(
        'SELECT code FROM auth.roles WHERE is_active = true AND code = ANY($1::varchar[])',
        [codes],
    );
    return rows.map((row) => row.code);
};

const replacePermissions = async (layerId, permissions) => {
    const client = await db.getClient();
    try {
        await client.query('BEGIN');
        const exists = await client.query(
            'SELECT id FROM gis.layers WHERE id = $1 AND deleted_at IS NULL FOR UPDATE',
            [layerId],
        );
        if (!exists.rowCount) {
            await client.query('ROLLBACK');
            return null;
        }
        await client.query('DELETE FROM gis.layer_permissions WHERE layer_id = $1', [layerId]);
        for (const item of permissions) {
            await client.query(
                `INSERT INTO gis.layer_permissions
                    (layer_id, role_code, can_view, can_export, can_edit, can_delete)
                 VALUES ($1, $2, $3, $4, $5, $6)`,
                [
                    layerId,
                    item.roleCode,
                    item.canView,
                    item.canExport,
                    item.canEdit,
                    item.canDelete,
                ],
            );
        }
        const {
            rows: [version],
        } = await client.query(
            'UPDATE gis.layers SET version = version + 1 WHERE id = $1 RETURNING updated_at, version',
            [layerId],
        );
        const layer = await findById(layerId, false, client);
        layer.updated_at = version.updated_at;
        layer.version = version.version;
        await client.query('COMMIT');
        return layer;
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
};

const softDeleteAndEnqueue = async (id, expectedUpdatedAt, actorId, deleteFiles = false) => {
    const client = await db.getClient();
    try {
        await client.query('BEGIN');
        const {
            rows: [deleted],
        } = await client.query(
            `UPDATE gis.layers
             SET deleted_at = NOW(), cleanup_status = 'queued', publish_status = 'unpublished', version = version + 1
             WHERE id = $1 AND deleted_at IS NULL${versionCondition(2)}
             RETURNING *`,
            [id, expectedUpdatedAt],
        );
        if (!deleted) {
            await client.query('ROLLBACK');
            return null;
        }
        await client.query(
            `INSERT INTO gis.layer_cleanup_jobs (layer_id) VALUES ($1)
             ON CONFLICT (layer_id) WHERE status IN ('queued', 'running') DO NOTHING`,
            [id],
        );
        if (deleteFiles && deleted.source_file_id) {
            const references = await fileCleanupRepository.lockedActiveReferences(
                deleted.source_file_id,
                client,
            );
            if (references.length) {
                await client.query('ROLLBACK');
                return { conflict: 'FILE_STILL_IN_USE', references };
            }
        }
        let fileJob = null;
        if (deleteFiles && deleted.source_file_id) {
            fileJob = await fileCleanupRepository.enqueue(client, {
                fileObjectId: deleted.source_file_id,
                requestedBy: actorId,
                sourceType: 'layer',
                sourceId: deleted.id,
            });
        }
        await client.query('COMMIT');
        return {
            ...deleted,
            fileCleanupQueued: Boolean(fileJob),
            fileObjectIds: deleteFiles && deleted.source_file_id ? [deleted.source_file_id] : [],
        };
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
};

const setPublishState = async (id, publishStatus, geoserverLayer = null) => {
    const {
        rows: [row],
    } = await db.query(
        `UPDATE gis.layers
         SET publish_status = $2, geoserver_layer = COALESCE($3, geoserver_layer), version = version + 1
         WHERE id = $1 AND deleted_at IS NULL RETURNING *`,
        [id, publishStatus, geoserverLayer],
    );
    return row || null;
};

module.exports = {
    list,
    findById,
    findByCode,
    upsertLayerByCode,
    updatePublishedMetadata,
    updateMetadata,
    updateStandardMetadata,
    activeRoleCodes,
    replacePermissions,
    softDeleteAndEnqueue,
    setPublishState,
};
