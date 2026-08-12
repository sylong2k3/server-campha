'use strict';

const db = require('../configs/database');
const { versionCondition } = require('../utils/optimistic-lock.util');
const pageResult = (rows) => ({
    items: rows.map(({ total_count: _total, ...row }) => row),
    total: rows[0]?.total_count || 0,
});
const selectFields = `s.id,s.scene_code,s.title,s.platform,s.thematic_group,s.coverage_key,s.acquired_at,
    s.product_level,s.resolution_m,s.cloud_cover_percent,s.orbit_number,s.description,s.layer_id,
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

const preparePublish = async (id, input, actorId) => {
    const client = await db.getClient();
    try {
        await client.query('BEGIN');
        const {
            rows: [image],
        } = await client.query(
            `SELECT s.*, f.object_key, f.bucket, f.original_name, f.size_bytes, f.sha256
             FROM raster.satellite_images s
             JOIN core.file_objects f ON f.id = s.file_object_id
             WHERE s.id = $1 AND s.deleted_at IS NULL
               AND f.category = 'raster' AND f.lifecycle_status = 'ready'
               AND f.scan_status = 'clean' AND f.detected_mime = 'image/tiff'
             FOR UPDATE OF s`,
            [id],
        );
        if (!image) {
            await client.query('ROLLBACK');
            return null;
        }
        const metadata = {
            ...input.metadata,
            satelliteImageId: image.id,
            sceneCode: image.scene_code,
            acquiredAt: image.acquired_at,
            platform: image.platform,
            resolutionM: image.resolution_m,
            sourceFile: {
                id: image.file_object_id,
                originalName: image.original_name,
                sizeBytes: image.size_bytes,
                sha256: image.sha256,
            },
        };
        const values = [
            input.code,
            input.nameVi,
            input.category,
            input.srid,
            image.object_key,
            image.file_object_id,
            input.minZoom ?? null,
            input.maxZoom ?? null,
            JSON.stringify(input.legendConfig || {}),
            JSON.stringify(metadata),
            input.isPublic,
            actorId,
        ];
        let layer;
        if (image.layer_id) {
            const {
                rows: [updated],
            } = await client.query(
                `UPDATE gis.layers
                 SET code=$1,name_vi=$2,category=$3,geometry_type='RASTER',srid=$4,
                     storage_kind='geotiff_minio',table_name=NULL,object_key=$5,source_file_id=$6,
                     min_zoom=$7,max_zoom=$8,legend_config=$9::jsonb,metadata=$10::jsonb,
                     is_public=$11,publish_status='pending',version=version+1
                 WHERE id=$13 AND deleted_at IS NULL RETURNING *`,
                [...values, image.layer_id],
            );
            layer = updated;
        } else {
            const {
                rows: [created],
            } = await client.query(
                `INSERT INTO gis.layers
                    (code,name_vi,category,geometry_type,srid,storage_kind,object_key,source_file_id,
                     min_zoom,max_zoom,legend_config,metadata,is_public,publish_status,created_by)
                 VALUES ($1,$2,$3,'RASTER',$4,'geotiff_minio',$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11,'pending',$12)
                 RETURNING *`,
                values,
            );
            layer = created;
            await client.query(
                'UPDATE raster.satellite_images SET layer_id=$2,updated_by=$3 WHERE id=$1',
                [id, layer.id, actorId],
            );
        }
        await client.query('COMMIT');
        return { image, layer };
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
};

const setPublishState = async (imageId, layerId, publishStatus, geoserverLayer = null) => {
    const {
        rows: [row],
    } = await db.query(
        `UPDATE gis.layers
         SET publish_status=$3,geoserver_layer=COALESCE($4,geoserver_layer),version=version+1
         WHERE id=$2 AND deleted_at IS NULL
           AND EXISTS (SELECT 1 FROM raster.satellite_images WHERE id=$1 AND layer_id=$2 AND deleted_at IS NULL)
         RETURNING *`,
        [imageId, layerId, publishStatus, geoserverLayer],
    );
    return row || null;
};

module.exports = {
    list,
    find,
    create,
    categorize,
    remove,
    preparePublish,
    setPublishState,
};
