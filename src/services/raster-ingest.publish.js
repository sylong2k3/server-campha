'use strict';

/**
 * Raster ingest — GeoServer publish + layer registry + domain back-links.
 *
 * @ported-from migration/kt_gee_migration/services/raster-ingest.publish.js
 *
 * Adaptations for the Cẩm Phả flood domain:
 *   - Fire Risk and Forest Classification are intentionally absent.
 *   - `layer.repository` in this server does not (yet) expose findByCode /
 *     upsertLayerByCode. Callers must inject a repo with those methods, or
 *     accept the graceful "layerRepo not wired" error surfaced here.
 *   - Bucket URI uses category:objectKey instead of the reference's inline S3
 *     path (bucket resolution is done centrally via configs/minioClient).
 */

const fs = require('fs');
const path = require('path');

const cfg = require('../configs/raster-ingest');
const geoserverClient = require('../utils/geoserver.client');

const DEBUG = process.env.RASTER_INGEST_DEBUG === 'true' || process.env.NODE_ENV === 'development';
const dbg = (tag, msg) => {
    if (DEBUG) {
        console.debug(`[RASTER-INGEST:${tag}] ${new Date().toISOString()} — ${msg}`);
    }
};

// Repository interface expected by upsertRasterLayer(). Callers inject an
// object satisfying this shape; the current server's layer.repository does
// not (yet) expose these methods, so DI is mandatory until GEE-S05 lands the
// repo extensions.
//   findByCode(code) → Promise<{ id, geoserver_layer? } | null>
//   upsertLayerByCode(client, payload) → Promise<{ id }>
//   updatePublishedMetadata(client, id, patch) → Promise<void>

// ── 1. GeoServer publish ──────────────────────────────────────────────────────

/**
 * Copy the COG into `GEOSERVER_DATA_DIR/flood-rasters/<store>.tif` and create
 * a filesystem-backed GeoTIFF CoverageStore. If the layer already exists
 * (re-ingest of the same layer_code), truncate the GWC cache best-effort.
 *
 * Publication uses the FileSystem mirror pattern documented in architecture
 * doc §41 (gs-s3-geotiff not available in current GeoServer install).
 *
 * @param {object} args
 * @param {string} args.storeName
 * @param {string} args.cogPath
 * @param {object} args.params
 * @param {object} [deps]
 * @param {object} [deps.layerRepo]     — required for re-ingest detection
 * @param {object} [deps.geoserver]     — override utils/geoserver.client
 * @param {object} [deps.fsPromises]    — override fs.promises (test)
 * @returns {Promise<{ geoserverLayer, publishPath, isReingest }>}
 */
async function publishToGeoServer({ storeName, cogPath, params }, deps = {}) {
    if (!storeName || !cogPath) {
        throw new Error('publishToGeoServer requires storeName + cogPath');
    }
    const geoserver = deps.geoserver || geoserverClient;
    const layerRepo = deps.layerRepo || require('../repositories/layer.repository');
    const fsp = deps.fsPromises || fs.promises;

    const gsDataDir = process.env.GEOSERVER_DATA_DIR;
    if (!gsDataDir) {
        throw new Error(
            'GEOSERVER_DATA_DIR not configured — required for filesystem GeoTIFF publish',
        );
    }

    const publishCategory = 'flood-rasters';
    const publishDir = path.join(gsDataDir, publishCategory);
    const publishPath = path.join(publishDir, `${storeName}.tif`);
    await fsp.mkdir(publishDir, { recursive: true });
    await fsp.copyFile(cogPath, publishPath);
    dbg('PUBLISH', `copied cog → ${publishPath}`);

    // Re-ingest detection: same layer_code already carries a geoserver_layer.
    let isReingest = false;
    if (layerRepo && typeof layerRepo.findByCode === 'function') {
        const existing = await layerRepo.findByCode(storeName);
        isReingest = Boolean(existing?.geoserver_layer);
    }
    dbg('PUBLISH', `store=${storeName} isReingest=${isReingest} file=${publishPath}`);

    const geoserverLayer = await geoserver.publishFsGeoTiffLayer({
        storeName,
        filePath: publishPath,
        title: params?.nameVi || storeName,
        enabled: true,
    });
    if (typeof geoserver.verifyLayer === 'function') {
        await geoserver.verifyLayer(geoserverLayer);
    }

    if (isReingest && typeof geoserver.truncateGwcLayer === 'function') {
        await geoserver.truncateGwcLayer(geoserverLayer).catch((err) => {
            // Stale GWC cache is a nuisance, not a blocker.
            console.warn(
                `[RASTER-INGEST] GWC truncate FAILED layer=${geoserverLayer} — ${err.message}`,
            );
        });
        dbg('PUBLISH', `re-ingest: GWC truncated for ${geoserverLayer}`);
    }

    return { geoserverLayer, publishPath, isReingest };
}

// ── 2. layer_registry upsert ──────────────────────────────────────────────────

const DEFAULT_ANALYSIS_EPSG = 32648;

/**
 * INSERT (or UPDATE) gis.layer_registry, link the raster_ingest_job, and stamp
 * GEE metadata (scale, bbox, sha, task id). One transaction — if the metadata
 * UPDATE fails, the upsert rolls back too.
 *
 * @param {object} args
 * @param {object} args.job              — raster_ingest_jobs row
 * @param {object} args.params           — job.request_params
 * @param {string} args.storeName
 * @param {string} args.geoserverLayer
 * @param {string} args.objectKey        — MinIO object key
 * @param {string} args.sha              — SHA-256 hex of final COG
 * @param {object} [deps]
 * @param {object} [deps.db]             — override configs/database (test DI)
 * @param {object} [deps.layerRepo]      — must expose upsertLayerByCode + updatePublishedMetadata
 * @returns {Promise<{ id: number }>}
 */
async function upsertRasterLayer(
    { job, params, storeName, geoserverLayer, objectKey, sha },
    deps = {},
) {
    if (!job || !storeName || !geoserverLayer) {
        throw new Error('upsertRasterLayer requires job, storeName, geoserverLayer');
    }
    const db = deps.db || require('../configs/database');
    const layerRepo = deps.layerRepo || require('../repositories/layer.repository');
    if (!layerRepo || typeof layerRepo.upsertLayerByCode !== 'function') {
        throw new Error(
            'raster-ingest.publish.upsertRasterLayer requires a layerRepo with ' +
                'upsertLayerByCode(client, payload) — see GEE-S05 repo extension task',
        );
    }

    // PostgreSQL identifier: strip characters that layer_registry rejects.
    const registryTableName = String(storeName).replace(/[^a-zA-Z0-9_]/g, '_');
    const bucketCategory = params?.bucketCategory || 'flood-rasters';

    const client = await db.pool.connect();
    try {
        await client.query('BEGIN');
        const layer = await layerRepo.upsertLayerByCode(client, {
            code: job.layer_code,
            name_vi: params?.nameVi || job.layer_code,
            name_en: params?.nameEn || null,
            schema_name: 'gis',
            table_name: registryTableName,
            geometry_column: 'geom',
            geometry_type: 'RASTER',
            epsg_code: params?.epsg_code || DEFAULT_ANALYSIS_EPSG,
            category: params?.category || 'flood',
            layer_kind: 'overlay',
            layer_group: params?.layer_group || null,
            data_year: params?.data_year || new Date().getUTCFullYear(),
            source_dataset: 'gee',
            is_active: true,
            is_public: params?.isPublic ?? false,
            is_editable: false,
            object_key: objectKey,
            metadata: {
                minioBucketCategory: bucketCategory,
                minioUri: `minio://${bucketCategory}/${objectKey}`,
            },
            userId: job.created_by,
        });

        const metadataPatch = {
            geoserverLayer,
            geoserverStore: storeName,
            styleName: params?.styleName || null,
            rasterIngestJobId: job.id,
            rasterSourceUrl: job.source_url,
            rasterGeeMetadata: {
                gee_map_id: params?.gee_map_id || null,
                gee_task_id: params?.gee_task_id || null,
                scale_m: params?.scale_m || null,
                bbox: params?.bbox || null,
                file_sha256: sha,
                bucket_category: bucketCategory,
                ingested_at: new Date().toISOString(),
            },
        };
        if (typeof layerRepo.updatePublishedMetadata !== 'function') {
            throw new Error('layerRepo.updatePublishedMetadata(client, id, patch) is required');
        }
        await layerRepo.updatePublishedMetadata(client, layer.id, metadataPatch);

        await client.query('COMMIT');
        return layer;
    } catch (err) {
        try {
            await client.query('ROLLBACK');
        } catch {
            /* nested rollback failures aren't fatal */
        }
        throw err;
    } finally {
        client.release();
    }
}

// ── 3. Domain back-links ─────────────────────────────────────────────────────

/**
 * Update gis.flood_artifacts.publish_status='published' and stamp
 * published_at + workspace/coverage/layer/style so the client can render.
 */
async function backLinkResource(linked, ctx, deps = {}) {
    if (!linked?.type || !linked?.id) {
        return { skipped: true };
    }
    const db = deps.db || require('../configs/database');

    if (linked.type !== 'flood_artifact') {
        console.warn(`[RASTER-INGEST] backLink unsupported type=${linked.type}`);
        return { skipped: true };
    }
    const artifactId = Number(linked.id);
    if (!Number.isFinite(artifactId)) {
        return { skipped: true };
    }

    const [workspace, layerNameWithoutWorkspace] =
        String(ctx.geoserverLayer || '').split(':', 2).length === 2
            ? ctx.geoserverLayer.split(':')
            : [null, ctx.geoserverLayer];

    const result = await db.query(
        `UPDATE gis.flood_artifacts
            SET publish_status = CASE WHEN $17 THEN 'published' ELSE 'unpublished' END,
                published_at   = CASE WHEN $17 THEN NOW() ELSE NULL END,
                workspace      = COALESCE($2, workspace),
                coverage_store = COALESCE($3, coverage_store),
                layer_name     = COALESCE($4, layer_name),
                minio_bucket   = COALESCE($5, minio_bucket),
                minio_object_key = COALESCE($6, minio_object_key)
                , ingest_job_id = COALESCE($7, ingest_job_id)
                , checksum_sha256 = COALESCE($8, checksum_sha256)
                , size_bytes = COALESCE($9, size_bytes)
                , crs = COALESCE($10, crs)
                , width = COALESCE($11, width)
                , height = COALESCE($12, height)
                , resolution_m = COALESCE($13, resolution_m)
                , bbox = COALESCE($14::jsonb, bbox)
                , band_count = COALESCE($15, band_count)
                , data_type = COALESCE($16, data_type)
          WHERE id = $1`,
        [
            artifactId,
            workspace,
            ctx.geoserverStore || null,
            layerNameWithoutWorkspace || null,
            ctx.minioCategory || null,
            ctx.minioKey || null,
            ctx.rasterIngestJobId || null,
            ctx.sha256 || null,
            ctx.sizeBytes ?? null,
            ctx.crs || null,
            ctx.width ?? null,
            ctx.height ?? null,
            ctx.resolutionM ?? null,
            ctx.bbox ? JSON.stringify(ctx.bbox) : null,
            ctx.bandCount ?? null,
            ctx.dataType || null,
            ctx.published !== false,
        ],
    );

    if (result?.rowCount > 0) {
        console.info(
            `[RASTER-INGEST] backlink ok flood_artifact#${artifactId} → ${ctx.geoserverLayer}`,
        );
    } else {
        console.warn(
            `[RASTER-INGEST] backlink flood_artifact#${artifactId} → 0 rows updated ` +
                '(row missing or already terminal?)',
        );
    }
    return { rowCount: result?.rowCount || 0 };
}

async function markBackLinkFailed(linked, error, deps = {}) {
    if (linked?.type !== 'flood_artifact' || !Number.isFinite(Number(linked.id))) {
        return { skipped: true };
    }
    const db = deps.db || require('../configs/database');
    const safeMessage = String(error?.message || 'Raster publication failed')
        .replace(/https?:\/\/\S+/gi, '[redacted-url]')
        .slice(0, 500);
    return db.query(
        `UPDATE gis.flood_artifacts
            SET publish_status = 'failed',
                published_at = NULL,
                metadata = COALESCE(metadata, '{}'::jsonb) ||
                    jsonb_build_object('publishError', $2::text)
          WHERE id = $1`,
        [Number(linked.id), safeMessage],
    );
}

module.exports = {
    publishToGeoServer,
    upsertRasterLayer,
    backLinkResource,
    markBackLinkFailed,
    DEFAULT_ANALYSIS_EPSG,
    _internal: { cfg },
};
