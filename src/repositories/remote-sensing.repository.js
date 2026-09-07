'use strict';

const db = require('../configs/database');
const fileCleanupRepository = require('./file-cleanup.repository');
const { versionCondition } = require('../utils/optimistic-lock.util');
const pageResult = (rows) => ({
    items: rows.map(({ total_count: _total, ...row }) => row),
    total: rows[0]?.total_count || 0,
});
const selectFields = `s.id,s.scene_code,s.title,s.platform,s.thematic_group,s.coverage_key,s.acquired_at,
    s.product_level,s.resolution_m,s.cloud_cover_percent,s.orbit_number,s.description,s.layer_id,s.standalone_layer_id,
    f.original_name,f.size_bytes,s.created_at,s.updated_at`;

const PUBLISH_ERROR = Object.freeze({
    TARGET_CONFLICT: 'RASTER_LAYER_TARGET_CONFLICT',
    CODE_RETIRED: 'LAYER_CODE_RETIRED',
    CLEANUP_PENDING: 'LAYER_CLEANUP_PENDING',
    CLEANUP_REQUIRED: 'LAYER_CLEANUP_REQUIRED',
});
const publishError = (code, message) => Object.assign(new Error(message), { code });
const publishMetadata = (metadata) => {
    const safe = { ...metadata };
    for (const key of [
        'timeSeries',
        'geoserverStore',
        'geoserverStoreKind',
        'geoserverLayer',
        'geoserverPublishCategory',
        'rasterIngestJobId',
    ]) {
        delete safe[key];
    }
    return safe;
};
const lockPublishLayers = async (client, linkedIds, code, imageId = null) => {
    const { rows } = await client.query(
        `SELECT l.*,
                EXISTS (SELECT 1 FROM raster.satellite_images s WHERE s.layer_id=l.id)
                    AS has_collection_members,
                EXISTS (SELECT 1 FROM raster.satellite_images s
                        WHERE s.standalone_layer_id=l.id AND s.deleted_at IS NULL
                          AND s.id IS DISTINCT FROM $3::bigint) AS has_other_standalone,
                EXISTS (SELECT 1 FROM raster.satellite_images s
                        WHERE s.file_object_id=l.source_file_id
                          AND (s.standalone_layer_id=l.id
                               OR s.id::text=l.metadata->>'satelliteImageId')) AS has_standalone_source
         FROM gis.layers l WHERE l.id=ANY($1::bigint[]) OR l.code=$2
         ORDER BY l.id FOR UPDATE OF l`,
        [linkedIds, code, imageId],
    );
    return rows;
};
const requireCompletedCleanup = async (client, layer) => {
    // ponytail: repair only links touched by publish; bulk backfill needs a separate review.
    const {
        rows: [job],
    } = await client.query(
        `SELECT status,
                EXISTS (SELECT 1 FROM gis.layer_cleanup_jobs
                        WHERE layer_id=$1 AND status IN ('queued','running')) AS has_active_job
         FROM gis.layer_cleanup_jobs WHERE layer_id=$1
         ORDER BY created_at DESC,id DESC LIMIT 1`,
        [layer.id],
    );
    if (['queued', 'running'].includes(layer.cleanup_status) || job?.has_active_job) {
        throw publishError(
            PUBLISH_ERROR.CLEANUP_PENDING,
            'Lớp cũ đang được dọn; hãy chờ cleanup hoàn tất',
        );
    }
    if (layer.cleanup_status !== 'complete' || job?.status !== 'succeeded') {
        throw publishError(
            PUBLISH_ERROR.CLEANUP_REQUIRED,
            'Chưa xác nhận dọn xong lớp cũ; cần người vận hành kiểm tra và phục hồi cleanup',
        );
    }
};

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

const listAdmin = async (filter) => {
    const params = [];
    const where = ['s.deleted_at IS NULL', "f.lifecycle_status='ready'"];
    const add = (value, sql) => {
        if (value !== undefined && value !== null && value !== '') {
            params.push(value);
            where.push(sql.replace('?', `$${params.length}`));
        }
    };
    if (filter.q) {
        params.push(`%${filter.q}%`);
        where.push(
            `(unaccent(lower(s.title)) ILIKE unaccent(lower($${params.length})) OR unaccent(lower(s.scene_code)) ILIKE unaccent(lower($${params.length})) OR unaccent(lower(f.original_name)) ILIKE unaccent(lower($${params.length})))`,
        );
    }
    add(filter.coverageKey, 's.coverage_key=?');
    add(filter.platform, 's.platform=?');
    add(filter.thematicGroup, 's.thematic_group=?');
    add(filter.from, 's.acquired_at>=?::timestamptz');
    add(filter.to, 's.acquired_at<=?::timestamptz');

    if (filter.status && filter.status !== 'all') {
        switch (filter.status) {
            case 'unpublished':
                where.push(
                    '((sl.id IS NULL OR sl.deleted_at IS NOT NULL) AND (tl.id IS NULL OR tl.deleted_at IS NOT NULL))',
                );
                break;
            case 'standalone':
                where.push('s.standalone_layer_id IS NOT NULL');
                break;
            case 'time_series':
                where.push('s.layer_id IS NOT NULL');
                break;
            case 'in_use':
                where.push('(sl.deleted_at IS NULL OR tl.deleted_at IS NULL)');
                break;
            case 'cleanup_pending':
                where.push(
                    "(sl.cleanup_status IN ('queued','running') OR tl.cleanup_status IN ('queued','running'))",
                );
                break;
            case 'cleanup_failed':
                where.push(
                    "((sl.deleted_at IS NOT NULL AND sl.cleanup_status NOT IN ('complete','none')) OR (tl.deleted_at IS NOT NULL AND tl.cleanup_status NOT IN ('complete','none')))",
                );
                break;
        }
    }

    params.push(filter.limit, (filter.page - 1) * filter.limit);
    const direction = filter.sort === 'acquiredAt:asc' ? 'ASC' : 'DESC';
    const { rows } = await db.query(
        `SELECT ${selectFields},
                sl.id AS sl_id, sl.code AS sl_code, sl.name_vi AS sl_name_vi,
                sl.publish_status AS sl_publish_status, sl.cleanup_status AS sl_cleanup_status, sl.deleted_at AS sl_deleted_at,
                tl.id AS tl_id, tl.code AS tl_code, tl.name_vi AS tl_name_vi,
                tl.publish_status AS tl_publish_status, tl.cleanup_status AS tl_cleanup_status, tl.deleted_at AS tl_deleted_at,
                COUNT(*) OVER()::int AS total_count
         FROM raster.satellite_images s
         JOIN core.file_objects f ON f.id=s.file_object_id
         LEFT JOIN gis.layers sl ON sl.id=s.standalone_layer_id
         LEFT JOIN gis.layers tl ON tl.id=s.layer_id
         WHERE ${where.join(' AND ')}
         ORDER BY s.acquired_at ${direction}, s.id ${direction}
         LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params,
    );
    return {
        items: rows.map(({ total_count: _total, ...row }) => ({
            id: row.id,
            scene_code: row.scene_code,
            title: row.title,
            platform: row.platform,
            thematic_group: row.thematic_group,
            coverage_key: row.coverage_key,
            acquired_at: row.acquired_at,
            product_level: row.product_level,
            resolution_m: row.resolution_m,
            cloud_cover_percent: row.cloud_cover_percent,
            orbit_number: row.orbit_number,
            description: row.description,
            layer_id: row.layer_id,
            standalone_layer_id: row.standalone_layer_id,
            original_name: row.original_name,
            size_bytes: row.size_bytes,
            created_at: row.created_at,
            updated_at: row.updated_at,
            standaloneLayer: row.sl_id
                ? {
                      id: row.sl_id,
                      code: row.sl_code,
                      nameVi: row.sl_name_vi,
                      publishStatus: row.sl_publish_status,
                      cleanupStatus: row.sl_cleanup_status,
                      deletedAt: row.sl_deleted_at,
                  }
                : null,
            timeSeriesLayer: row.tl_id
                ? {
                      id: row.tl_id,
                      code: row.tl_code,
                      nameVi: row.tl_name_vi,
                      publishStatus: row.tl_publish_status,
                      cleanupStatus: row.tl_cleanup_status,
                      deletedAt: row.tl_deleted_at,
                  }
                : null,
        })),
        total: rows[0]?.total_count || 0,
    };
};

const listCollections = async (filter) => {
    const params = [];
    const where = ['s.deleted_at IS NULL', "f.lifecycle_status='ready'"];
    if (filter.q) {
        params.push(`%${filter.q}%`);
        where.push(
            `(unaccent(lower(s.coverage_key)) ILIKE unaccent(lower($${params.length})) OR unaccent(lower(COALESCE(s.thematic_group, ''))) ILIKE unaccent(lower($${params.length})))`,
        );
    }

    let orderBy = 'MAX(s.acquired_at) DESC, s.coverage_key ASC';
    if (filter.sort === 'latestAcquiredAt:asc') {
        orderBy = 'MAX(s.acquired_at) ASC, s.coverage_key ASC';
    } else if (filter.sort === 'totalImages:desc') {
        orderBy = 'COUNT(*) DESC, s.coverage_key ASC';
    } else if (filter.sort === 'totalImages:asc') {
        orderBy = 'COUNT(*) ASC, s.coverage_key ASC';
    }

    params.push(filter.limit, (filter.page - 1) * filter.limit);

    const { rows } = await db.query(
        `SELECT s.coverage_key,
                MAX(s.thematic_group) AS thematic_group,
                COUNT(*)::int AS total_images,
                COUNT(DISTINCT s.acquired_at)::int AS unique_dates,
                MIN(s.acquired_at) AS earliest_acquired_at,
                MAX(s.acquired_at) AS latest_acquired_at,
                (COUNT(*) > COUNT(DISTINCT s.acquired_at)) AS has_duplicate_dates,
                (COUNT(*) - COUNT(DISTINCT s.acquired_at))::int AS duplicate_date_count,
                (COUNT(*) >= 2 AND COUNT(*) = COUNT(DISTINCT s.acquired_at)) AS is_publishable,
                cl.id AS cl_id,
                cl.code AS cl_code,
                cl.name_vi AS cl_name_vi,
                cl.publish_status AS cl_publish_status,
                cl.cleanup_status AS cl_cleanup_status,
                cl.deleted_at AS cl_deleted_at,
                COUNT(*) OVER()::int AS total_count
         FROM raster.satellite_images s
         JOIN core.file_objects f ON f.id = s.file_object_id
         LEFT JOIN LATERAL (
             SELECT l.id, l.code, l.name_vi, l.publish_status, l.cleanup_status, l.deleted_at
             FROM gis.layers l
             WHERE l.metadata->'timeSeries'->>'coverageKey' = s.coverage_key
               AND l.storage_kind = 'geotiff_minio'
             ORDER BY (l.deleted_at IS NULL) DESC, l.id DESC
             LIMIT 1
         ) cl ON true
         WHERE ${where.join(' AND ')}
         GROUP BY s.coverage_key, cl.id, cl.code, cl.name_vi, cl.publish_status, cl.cleanup_status, cl.deleted_at
         ORDER BY ${orderBy}
         LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params,
    );

    return {
        items: rows.map((row) => ({
            coverageKey: row.coverage_key,
            thematicGroup: row.thematic_group,
            totalImages: row.total_images,
            uniqueDates: row.unique_dates,
            earliestAcquiredAt: row.earliest_acquired_at,
            latestAcquiredAt: row.latest_acquired_at,
            hasDuplicateDates: row.has_duplicate_dates,
            duplicateDateCount: row.duplicate_date_count,
            isPublishable: row.is_publishable,
            collectionLayer: row.cl_id
                ? {
                      id: row.cl_id,
                      code: row.cl_code,
                      nameVi: row.cl_name_vi,
                      publishStatus: row.cl_publish_status,
                      cleanupStatus: row.cl_cleanup_status,
                      deletedAt: row.cl_deleted_at,
                  }
                : null,
        })),
        total: rows[0]?.total_count || 0,
    };
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
            `SELECT s.id,s.file_object_id,s.layer_id,s.standalone_layer_id,s.updated_at
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
        if (image.standalone_layer_id) {
            const {
                rows: [standaloneLayer],
            } = await client.query(
                `SELECT id FROM gis.layers
                 WHERE id=$1 AND deleted_at IS NULL AND publish_status='published'
                 FOR UPDATE`,
                [image.standalone_layer_id],
            );
            if (standaloneLayer) {
                await client.query('ROLLBACK');
                return { conflict: 'LAYER_PUBLISHED' };
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
            ...publishMetadata(input.metadata),
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
        const candidates = await lockPublishLayers(
            client,
            image.standalone_layer_id ? [image.standalone_layer_id] : [],
            input.code,
            image.id,
        );
        let linkedLayer = candidates.find(
            (candidate) => String(candidate.id) === String(image.standalone_layer_id),
        );
        if (image.standalone_layer_id && !linkedLayer) {
            throw publishError(
                PUBLISH_ERROR.CLEANUP_REQUIRED,
                'Không xác minh được lớp đã liên kết',
            );
        }
        if (linkedLayer?.deleted_at) {
            await requireCompletedCleanup(client, linkedLayer);
            linkedLayer = null;
        }
        const codeLayer = candidates.find((candidate) => candidate.code === input.code);
        if (codeLayer?.deleted_at) {
            throw publishError(
                PUBLISH_ERROR.CODE_RETIRED,
                'Mã lớp đã từng được sử dụng; hãy dùng mã mới',
            );
        }
        const target = linkedLayer || codeLayer;
        if (
            target &&
            (target.code !== input.code ||
                target.geometry_type !== 'RASTER' ||
                target.storage_kind !== 'geotiff_minio' ||
                target.table_name ||
                !target.source_file_id ||
                !target.object_key ||
                !target.has_standalone_source ||
                target.has_collection_members ||
                target.has_other_standalone ||
                String(target.metadata?.timeSeries?.enabled) === 'true' ||
                target.metadata?.geoserverStoreKind === 'imagemosaic_upload' ||
                target.metadata?.rasterIngestJobId)
        ) {
            throw publishError(
                PUBLISH_ERROR.TARGET_CONFLICT,
                'Lớp đích không phải GeoTIFF standalone tương thích hoặc mã khác lớp đã liên kết; không được ghi đè collection hay lớp của ảnh khác',
            );
        }
        if (target) {
            const {
                rows: [updated],
            } = await client.query(
                `UPDATE gis.layers
                 SET code=$1,name_vi=$2,category=$3,geometry_type='RASTER',srid=$4,
                     storage_kind='geotiff_minio',table_name=NULL,object_key=$5,source_file_id=$6,
                     min_zoom=$7,max_zoom=$8,legend_config=$9::jsonb,metadata=$10::jsonb,
                     is_public=$11,publish_status='pending',version=version+1
                 WHERE id=$12 AND deleted_at IS NULL RETURNING *`,
                [...values.slice(0, 11), target.id],
            );
            if (!updated) {
                await client.query('ROLLBACK');
                return null;
            }
            layer = updated;
            if (String(image.standalone_layer_id) !== String(layer.id)) {
                await client.query(
                    'UPDATE raster.satellite_images SET standalone_layer_id=$2,updated_by=$3 WHERE id=$1',
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
                'UPDATE raster.satellite_images SET standalone_layer_id=$2,updated_by=$3 WHERE id=$1',
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
           AND EXISTS (SELECT 1 FROM raster.satellite_images WHERE id=$1 AND standalone_layer_id=$2 AND deleted_at IS NULL)
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

const collectionMetadata = (input, coverageKey, existingMetadata = {}) => ({
    ...publishMetadata(input.metadata),
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
            throw publishError(
                COLLECTION_ERROR.EMPTY,
                'Bộ GeoTIFF Time Series không có ảnh hợp lệ',
            );
        }
        const seen = new Set();
        for (const member of members) {
            const time = new Date(member.acquired_at).toISOString();
            if (seen.has(time)) {
                throw publishError(
                    COLLECTION_ERROR.DUPLICATE_TIME,
                    `Bộ GeoTIFF có nhiều ảnh tại ${time}`,
                );
            }
            seen.add(time);
        }
        const linkedLayerIds = [
            ...new Set(
                members
                    .map((member) => member.layer_id)
                    .filter(Boolean)
                    .map(String),
            ),
        ];
        const candidates = await lockPublishLayers(client, linkedLayerIds, input.code);
        const activeLinkedIds = [];
        for (const linkedId of linkedLayerIds) {
            const linkedLayer = candidates.find((candidate) => String(candidate.id) === linkedId);
            if (linkedLayer?.deleted_at) {
                await requireCompletedCleanup(client, linkedLayer);
            } else {
                activeLinkedIds.push(linkedId);
            }
        }
        if (activeLinkedIds.length > 1) {
            throw publishError(
                COLLECTION_ERROR.MEMBER_CONFLICT,
                'Ảnh trong collection đang thuộc nhiều lớp khác nhau',
            );
        }
        const codeLayer = candidates.find((candidate) => candidate.code === input.code);
        if (codeLayer?.deleted_at) {
            throw publishError(
                PUBLISH_ERROR.CODE_RETIRED,
                'Mã lớp đã từng được sử dụng và không thể tái tạo',
            );
        }
        const linkedLayerId = activeLinkedIds[0] || null;
        if (linkedLayerId && String(codeLayer?.id) !== linkedLayerId) {
            throw publishError(
                COLLECTION_ERROR.MEMBER_CONFLICT,
                'Ảnh trong collection đang thuộc lớp khác',
            );
        }
        if (
            codeLayer &&
            (codeLayer.storage_kind !== 'geotiff_minio' ||
                codeLayer.geometry_type !== 'RASTER' ||
                codeLayer.object_key ||
                codeLayer.source_file_id ||
                codeLayer.has_other_standalone ||
                codeLayer.metadata?.timeSeries?.enabled !== true ||
                codeLayer.metadata?.timeSeries?.coverageKey !== coverageKey)
        ) {
            throw publishError(
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
                `UPDATE gis.layers SET name_vi=$1,category=$2,geometry_type='RASTER',srid=$3,
                        storage_kind='geotiff_minio',table_name=NULL,object_key=NULL,source_file_id=NULL,
                        min_zoom=$4,max_zoom=$5,legend_config=$6::jsonb,metadata=$7::jsonb,
                        is_public=$8,publish_status='pending',cleanup_status='none',
                        version=version+1
                 WHERE id=$9 AND deleted_at IS NULL RETURNING *`,
                [...values.slice(1, 9), codeLayer.id],
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
            throw publishError(
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
const updateCoverageKey = async (id, coverageKey, actorId) => {
    const client = await db.getClient();
    try {
        await client.query('BEGIN');
        const {
            rows: [image],
        } = await client.query(
            `SELECT s.* FROM raster.satellite_images s WHERE s.id = $1 AND s.deleted_at IS NULL FOR UPDATE`,
            [id],
        );
        if (!image) {
            await client.query('ROLLBACK');
            return null;
        }
        if (image.coverage_key === coverageKey) {
            await client.query('COMMIT');
            return image;
        }

        const lockKeys = [image.coverage_key, coverageKey].sort();
        for (const key of lockKeys) {
            await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [key]);
        }

        let clearLayerId = false;
        if (image.layer_id) {
            const {
                rows: [tsLayer],
            } = await client.query(
                `SELECT id, deleted_at, cleanup_status FROM gis.layers WHERE id = $1`,
                [image.layer_id],
            );
            if (tsLayer && !tsLayer.deleted_at) {
                await client.query('ROLLBACK');
                return { conflict: 'TIME_SERIES_MEMBER' };
            }
            if (tsLayer && tsLayer.deleted_at) {
                try {
                    await requireCompletedCleanup(client, tsLayer);
                    clearLayerId = true;
                } catch (cleanupErr) {
                    await client.query('ROLLBACK');
                    if (cleanupErr.code === PUBLISH_ERROR.CLEANUP_PENDING) {
                        return { conflict: 'CLEANUP_PENDING' };
                    }
                    return { conflict: 'CLEANUP_REQUIRED' };
                }
            }
        }
        const { rows: duplicate } = await client.query(
            `SELECT id FROM raster.satellite_images
             WHERE coverage_key = $1 AND acquired_at = $2 AND id != $3 AND deleted_at IS NULL`,
            [coverageKey, image.acquired_at, id],
        );
        if (duplicate.length > 0) {
            await client.query('ROLLBACK');
            return { conflict: 'DUPLICATE_TIME' };
        }
        const {
            rows: [updated],
        } = await client.query(
            `UPDATE raster.satellite_images
             SET coverage_key = $2,
                 layer_id = CASE WHEN $4::boolean THEN NULL ELSE layer_id END,
                 updated_by = $3,
                 updated_at = NOW()
             WHERE id = $1 AND deleted_at IS NULL RETURNING *`,
            [id, coverageKey, actorId, clearLayerId],
        );
        await client.query('COMMIT');
        return updated;
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
};

const mergeCollections = async (sourceCoverageKeys, targetCoverageKey, actorId) => {
    const client = await db.getClient();
    try {
        await client.query('BEGIN');
        const allKeys = [...new Set([...sourceCoverageKeys, targetCoverageKey])].sort();
        for (const key of allKeys) {
            await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [key]);
        }
        const { rows: sourceImages } = await client.query(
            `SELECT s.id, s.acquired_at, s.coverage_key, s.layer_id, s.standalone_layer_id
             FROM raster.satellite_images s
             WHERE s.coverage_key = ANY($1::text[]) AND s.deleted_at IS NULL
             ORDER BY s.acquired_at, s.id
             FOR UPDATE OF s`,
            [sourceCoverageKeys],
        );
        if (!sourceImages.length) {
            await client.query('ROLLBACK');
            return { updatedCount: 0, targetCoverageKey };
        }

        const sourceLayerIds = [
            ...new Set(sourceImages.map((img) => img.layer_id).filter(Boolean)),
        ];
        if (sourceLayerIds.length > 0) {
            const { rows: layers } = await client.query(
                `SELECT id, code, deleted_at, cleanup_status FROM gis.layers WHERE id = ANY($1::bigint[])`,
                [sourceLayerIds],
            );
            for (const layer of layers) {
                if (!layer.deleted_at) {
                    throw publishError(
                        COLLECTION_ERROR.MEMBER_CONFLICT,
                        'Ảnh trong collection đang thuộc lớp chuỗi thời gian đang hoạt động',
                    );
                }
                await requireCompletedCleanup(client, layer);
            }
        }

        const { rows: targetImages } = await client.query(
            `SELECT s.id, s.acquired_at
             FROM raster.satellite_images s
             WHERE s.coverage_key = $1 AND s.deleted_at IS NULL
             ORDER BY s.acquired_at, s.id
             FOR UPDATE OF s`,
            [targetCoverageKey],
        );

        const targetTimes = new Set(
            targetImages.map((img) => new Date(img.acquired_at).toISOString()),
        );
        const seenSourceTimes = new Set();
        for (const img of sourceImages) {
            const timeIso = new Date(img.acquired_at).toISOString();
            if (targetTimes.has(timeIso) || seenSourceTimes.has(timeIso)) {
                throw publishError(
                    COLLECTION_ERROR.DUPLICATE_TIME,
                    `Có ảnh trùng mốc thời gian (${timeIso}) khi gộp vào nhóm đích`,
                );
            }
            seenSourceTimes.add(timeIso);
        }

        const sourceIds = sourceImages.map((img) => img.id);
        const { rowCount } = await client.query(
            `UPDATE raster.satellite_images
             SET coverage_key = $1,
                 layer_id = NULL,
                 updated_by = $2,
                 updated_at = NOW()
             WHERE id = ANY($3::bigint[]) AND deleted_at IS NULL`,
            [targetCoverageKey, actorId, sourceIds],
        );
        await client.query('COMMIT');
        return { updatedCount: rowCount, targetCoverageKey };
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
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
    updateCoverageKey,
    mergeCollections,
    listAdmin,
    listCollections,
    COLLECTION_ERROR,
    PUBLISH_ERROR,
};

