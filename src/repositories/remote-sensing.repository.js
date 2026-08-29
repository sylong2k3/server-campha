'use strict';

const db = require('../configs/database');
const fileCleanupRepository = require('./file-cleanup.repository');
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
const remove = async (id, expectedUpdatedAt, actorId, deleteFiles = false) => {
    const client = await db.getClient();
    try {
        await client.query('BEGIN');
        const {
            rows: [image],
        } = await client.query(
            `SELECT s.id,s.file_object_id,s.layer_id,s.updated_at
             FROM raster.satellite_images s
             WHERE s.id=$1 AND s.deleted_at IS NULL FOR UPDATE`,
            [id],
        );
        if (!image) {
            await client.query('ROLLBACK');
            return null;
        }
        if (image.layer_id) {
            const {
                rows: [timeSeriesLayer],
            } = await client.query(
                `SELECT id FROM gis.layers
                 WHERE id=$1 AND deleted_at IS NULL
                   AND metadata->'timeSeries'->>'enabled'='true'
                 FOR UPDATE`,
                [image.layer_id],
            );
            if (timeSeriesLayer) {
                await client.query('ROLLBACK');
                return { conflict: 'TIME_SERIES_MEMBER' };
            }
        }
        const version = versionCondition(2, 's.updated_at');
        const {
            rows: [row],
        } = await client.query(
            `UPDATE raster.satellite_images s SET deleted_at=NOW(),updated_by=$3
             WHERE s.id=$1 AND s.deleted_at IS NULL${version}
             RETURNING s.id,s.file_object_id`,
            [id, expectedUpdatedAt, actorId],
        );
        if (!row) {
            await client.query('ROLLBACK');
            return null;
        }
        if (deleteFiles) {
            const references = await fileCleanupRepository.lockedActiveReferences(
                row.file_object_id,
                client,
            );
            if (references.length) {
                await client.query('ROLLBACK');
                return { conflict: 'FILE_STILL_IN_USE', references };
            }
        }
        let job = null;
        if (deleteFiles) {
            job = await fileCleanupRepository.enqueue(client, {
                fileObjectId: row.file_object_id,
                requestedBy: actorId,
                sourceType: 'satellite_image',
                sourceId: row.id,
            });
        }
        await client.query('COMMIT');
        return {
            id: row.id,
            fileObjectIds: deleteFiles ? [row.file_object_id] : [],
            fileCleanupQueued: Boolean(job),
        };
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
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
        let targetLayerId = image.layer_id;
        if (!targetLayerId) {
            const {
                rows: [existingLayer],
            } = await client.query(
                `SELECT l.id
                 FROM gis.layers l
                 WHERE l.code = $1 AND l.deleted_at IS NULL
                   AND NOT EXISTS (
                       SELECT 1 FROM raster.satellite_images active
                       WHERE active.layer_id = l.id AND active.deleted_at IS NULL AND active.id <> $2
                   )
                 FOR UPDATE`,
                [input.code, image.id],
            );
            targetLayerId = existingLayer?.id || null;
        }
        if (targetLayerId) {
            const {
                rows: [updated],
            } = await client.query(
                `UPDATE gis.layers
                 SET code=$1,name_vi=$2,category=$3,geometry_type='RASTER',srid=$4,
                     storage_kind='geotiff_minio',table_name=NULL,object_key=$5,source_file_id=$6,
                     min_zoom=$7,max_zoom=$8,legend_config=$9::jsonb,metadata=$10::jsonb,
                     is_public=$11,publish_status='pending',version=version+1
                 WHERE id=$12 AND deleted_at IS NULL RETURNING *`,
                [...values.slice(0, 11), targetLayerId],
            );
            if (!updated) {
                await client.query('ROLLBACK');
                return null;
            }
            layer = updated;
            if (!image.layer_id) {
                await client.query(
                    'UPDATE raster.satellite_images SET layer_id=$2,updated_by=$3 WHERE id=$1',
                    [id, layer.id, actorId],
                );
            }
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

const COLLECTION_ERROR = Object.freeze({
    EMPTY: 'EMPTY_COLLECTION',
    DUPLICATE_TIME: 'DUPLICATE_COLLECTION_TIME',
    MEMBER_CONFLICT: 'COLLECTION_MEMBER_CONFLICT',
    LAYER_CONFLICT: 'COLLECTION_LAYER_CONFLICT',
});

const collectionError = (code, message) => Object.assign(new Error(message), { code });

const collectionMetadata = (input, coverageKey, existingMetadata = {}) => ({
    ...input.metadata,
    geoserverStore: input.code,
    geoserverStoreKind: 'imagemosaic_upload',
    timeSeries: {
        enabled: true,
        mode: 'discrete',
        coverageKey,
        ...(existingMetadata?.timeSeries?.storeUploaded === true ? { storeUploaded: true } : {}),
    },
});

const prepareCollectionPublish = async (coverageKey, input, actorId, roleCode) => {
    const client = await db.getClient();
    try {
        await client.query('BEGIN');
        const { rows: members } = await client.query(
            `SELECT s.id,s.scene_code,s.coverage_key,s.acquired_at,s.file_object_id,s.layer_id,
                    f.object_key,f.original_name,f.size_bytes,f.sha256,f.category
             FROM raster.satellite_images s
             JOIN core.file_objects f ON f.id=s.file_object_id
             WHERE s.coverage_key=$1 AND s.deleted_at IS NULL
               AND f.category='raster' AND f.lifecycle_status='ready'
               AND f.scan_status='clean' AND f.detected_mime='image/tiff'
             ORDER BY s.acquired_at,s.id
             FOR UPDATE OF s`,
            [coverageKey],
        );
        if (!members.length) {
            throw collectionError(
                COLLECTION_ERROR.EMPTY,
                'Bộ GeoTIFF Time Series không có ảnh hợp lệ',
            );
        }
        const seen = new Set();
        for (const member of members) {
            const time = new Date(member.acquired_at).toISOString();
            if (seen.has(time)) {
                throw collectionError(
                    COLLECTION_ERROR.DUPLICATE_TIME,
                    `Bộ GeoTIFF có nhiều ảnh tại ${time}`,
                );
            }
            seen.add(time);
        }
        const linkedLayerIds = [
            ...new Set(members.map((member) => member.layer_id).filter(Boolean)),
        ];
        if (linkedLayerIds.length > 1) {
            throw collectionError(
                COLLECTION_ERROR.MEMBER_CONFLICT,
                'Ảnh trong collection đang thuộc nhiều lớp khác nhau',
            );
        }
        const {
            rows: [codeLayer],
        } = await client.query(
            `SELECT id,code,storage_kind,publish_status,metadata,deleted_at
             FROM gis.layers WHERE code=$1 FOR UPDATE`,
            [input.code],
        );
        if (codeLayer?.deleted_at) {
            throw collectionError(
                COLLECTION_ERROR.LAYER_CONFLICT,
                'Mã lớp đã từng được sử dụng và không thể tái tạo',
            );
        }
        const linkedLayerId = linkedLayerIds[0] || null;
        if (linkedLayerId && codeLayer?.id !== linkedLayerId) {
            throw collectionError(
                COLLECTION_ERROR.MEMBER_CONFLICT,
                'Ảnh trong collection đang thuộc lớp khác',
            );
        }
        if (
            codeLayer &&
            (codeLayer.storage_kind !== 'geotiff_minio' ||
                codeLayer.metadata?.timeSeries?.enabled !== true ||
                codeLayer.metadata?.timeSeries?.coverageKey !== coverageKey)
        ) {
            throw collectionError(
                COLLECTION_ERROR.LAYER_CONFLICT,
                'Mã lớp đang thuộc tài nguyên khác',
            );
        }

        const metadata = collectionMetadata(input, coverageKey, codeLayer?.metadata);
        const values = [
            input.code,
            input.nameVi,
            input.category,
            input.srid,
            input.minZoom ?? null,
            input.maxZoom ?? null,
            JSON.stringify(input.legendConfig || {}),
            JSON.stringify(metadata),
            input.isPublic,
            actorId,
        ];
        let layer;
        if (codeLayer) {
            const {
                rows: [updated],
            } = await client.query(
                `UPDATE gis.layers SET name_vi=$2,category=$3,geometry_type='RASTER',srid=$4,
                        storage_kind='geotiff_minio',table_name=NULL,object_key=NULL,source_file_id=NULL,
                        min_zoom=$5,max_zoom=$6,legend_config=$7::jsonb,metadata=$8::jsonb,
                        is_public=$9,publish_status='pending',cleanup_status='none',updated_by=$10,
                        version=version+1
                 WHERE id=$11 AND deleted_at IS NULL RETURNING *`,
                [...values, codeLayer.id],
            );
            layer = updated;
        } else {
            const {
                rows: [created],
            } = await client.query(
                `INSERT INTO gis.layers
                    (code,name_vi,category,geometry_type,srid,storage_kind,object_key,source_file_id,
                     min_zoom,max_zoom,legend_config,metadata,is_public,publish_status,created_by)
                 VALUES ($1,$2,$3,'RASTER',$4,'geotiff_minio',NULL,NULL,$5,$6,$7::jsonb,$8::jsonb,$9,'pending',$10)
                 RETURNING *`,
                values,
            );
            layer = created;
        }
        if (!layer) {
            throw collectionError(
                COLLECTION_ERROR.LAYER_CONFLICT,
                'Không thể chuẩn bị lớp Time Series',
            );
        }
        await client.query(
            `UPDATE raster.satellite_images
             SET layer_id=$2,updated_by=$3
             WHERE id=ANY($1::bigint[])`,
            [members.map((member) => member.id), layer.id, actorId],
        );
        if (!input.isPublic && roleCode) {
            await client.query(
                `INSERT INTO gis.layer_permissions
                    (layer_id,role_code,can_view,can_export,can_edit,can_delete)
                 VALUES ($1,$2,true,false,false,false)
                 ON CONFLICT (layer_id,role_code) DO UPDATE SET can_view=true`,
                [layer.id, roleCode],
            );
        }
        await client.query('COMMIT');
        return { layer, members, values: [...seen] };
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
};

const markCollectionStoreOwned = async (layerId, coverageKey, geoserverLayer) => {
    const {
        rows: [row],
    } = await db.query(
        `UPDATE gis.layers
         SET geoserver_layer=$3,
             metadata=jsonb_set(metadata,'{timeSeries,storeUploaded}','true'::jsonb,true),
             version=version+1
         WHERE id=$1 AND deleted_at IS NULL
           AND metadata->'timeSeries'->>'coverageKey'=$2
         RETURNING *`,
        [layerId, coverageKey, geoserverLayer],
    );
    return row || null;
};

const setCollectionPublishState = async (
    layerId,
    coverageKey,
    publishStatus,
    geoserverLayer = null,
) => {
    const {
        rows: [row],
    } = await db.query(
        `UPDATE gis.layers
         SET publish_status=$3,geoserver_layer=COALESCE($4,geoserver_layer),version=version+1
         WHERE id=$1 AND deleted_at IS NULL
           AND metadata->'timeSeries'->>'coverageKey'=$2
         RETURNING *`,
        [layerId, coverageKey, publishStatus, geoserverLayer],
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
    prepareCollectionPublish,
    markCollectionStoreOwned,
    setCollectionPublishState,
    COLLECTION_ERROR,
};
