'use strict';

/**
 * Data-access layer for `gis.flood_artifacts` (raster and metric artifacts
 * produced by flood analysis runs).
 *
 * Consumed by:
 *   - services/flood/analysis.service.js        (listByRunId, findById)
 *   - services/flood/orchestrator.service.js    (createForRun, updateAssetMetadata)
 *   - services/flood/publish.service.js         (setPublishing, setPublished, setPublishFailed, setUnpublished)
 *   - admin backlink flow (raster-ingest.publish.backLinkResource)
 *   - client read endpoints                     (listPublished)
 *
 * @schema migrations/080_flood_domain.sql (gis.flood_artifacts)
 */

const db = require('../configs/database');

const PUBLISH_STATUSES = Object.freeze(['unpublished', 'publishing', 'published', 'failed']);
const ARTIFACT_ROLES = Object.freeze(['PRODUCT', 'QA', 'CALIBRATION']);

const findById = async (id, client = db) => {
    const { rows } = await client.query(
        'SELECT * FROM gis.flood_artifacts WHERE id = $1',
        [id],
    );
    return rows[0] || null;
};

const listByRunId = async (analysisRunId, client = db) => {
    const { rows } = await client.query(
        `SELECT *
           FROM gis.flood_artifacts
          WHERE analysis_run_id = $1
          ORDER BY id ASC`,
        [analysisRunId],
    );
    return rows;
};

/**
 * Look up the DB row for a currently-published (workspace, layer_name) tuple.
 * Used by the GeoServer ↔ DB reconciliation cron (fix reference §13.2 D).
 */
const findByLayerName = async (workspace, layerName, client = db) => {
    const { rows } = await client.query(
        `SELECT *
           FROM gis.flood_artifacts
          WHERE workspace = $1 AND layer_name = $2
            AND publish_status = 'published'
          ORDER BY published_at DESC NULLS LAST, id DESC
          LIMIT 1`,
        [workspace, layerName],
    );
    return rows[0] || null;
};

const listPublished = async ({
    module,
    from,
    to,
    limit = 20,
    offset = 0,
} = {}) => {
    const where = ["publish_status = 'published'"];
    const params = [];
    if (module) {
        params.push(module);
        where.push(`module = $${params.length}`);
    }
    if (from) {
        params.push(from);
        where.push(`published_at >= $${params.length}`);
    }
    if (to) {
        params.push(to);
        where.push(`published_at < $${params.length}`);
    }
    params.push(Math.max(1, Math.min(100, limit)));
    params.push(Math.max(0, offset));
    const { rows } = await db.query(
        `SELECT *, COUNT(*) OVER()::int AS total_count
           FROM gis.flood_artifacts
          WHERE ${where.join(' AND ')}
          ORDER BY published_at DESC NULLS LAST, id DESC
          LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params,
    );
    const total = rows[0]?.total_count || 0;
    return { items: rows.map(({ total_count: _t, ...row }) => row), total };
};

// ── Writes ───────────────────────────────────────────────────────────────────

const createForRun = async (payload, client = db) => {
    if (!ARTIFACT_ROLES.includes(payload.artifactRole)) {
        throw new Error(
            `Unsupported artifact_role: ${payload.artifactRole}. Expected one of ${ARTIFACT_ROLES.join(', ')}`,
        );
    }
    const { rows } = await client.query(
        `INSERT INTO gis.flood_artifacts (
            analysis_run_id, module, artifact_code, artifact_role, pipeline_version, metadata
         ) VALUES ($1, $2, $3, $4, $5, $6::jsonb)
         RETURNING *`,
        [
            payload.analysisRunId,
            payload.module,
            payload.artifactCode,
            payload.artifactRole,
            payload.pipelineVersion,
            JSON.stringify(payload.metadata || {}),
        ],
    );
    return rows[0];
};

/**
 * Stamp raster metadata after the raster-ingest pipeline finishes archiving to
 * MinIO. Every column uses COALESCE so partial updates never clobber a value
 * an earlier stage already set (§22-G checksum, §22-F CRS).
 */
const updateAssetMetadata = async (id, patch, client = db) => {
    const { rows } = await client.query(
        `UPDATE gis.flood_artifacts SET
            gcs_bucket        = COALESCE($2,  gcs_bucket),
            gcs_object        = COALESCE($3,  gcs_object),
            minio_bucket      = COALESCE($4,  minio_bucket),
            minio_object_key  = COALESCE($5,  minio_object_key),
            checksum_sha256   = COALESCE($6,  checksum_sha256),
            size_bytes        = COALESCE($7,  size_bytes),
            content_type      = COALESCE($8,  content_type),
            crs               = COALESCE($9,  crs),
            width             = COALESCE($10, width),
            height            = COALESCE($11, height),
            resolution_m      = COALESCE($12, resolution_m),
            nodata            = COALESCE($13, nodata),
            bbox              = COALESCE($14::jsonb, bbox),
            band_count        = COALESCE($15, band_count),
            data_type         = COALESCE($16, data_type),
            ingest_job_id     = COALESCE($17, ingest_job_id),
            metadata          = COALESCE(metadata, '{}'::jsonb) || $18::jsonb
          WHERE id = $1
          RETURNING *`,
        [
            id,
            patch.gcsBucket || null,
            patch.gcsObject || null,
            patch.minioBucket || null,
            patch.minioObjectKey || null,
            patch.checksumSha256 || null,
            patch.sizeBytes ?? null,
            patch.contentType || null,
            patch.crs || null,
            patch.width ?? null,
            patch.height ?? null,
            patch.resolutionM ?? null,
            patch.nodata ?? null,
            patch.bbox ? JSON.stringify(patch.bbox) : null,
            patch.bandCount ?? null,
            patch.dataType || null,
            patch.ingestJobId ?? null,
            JSON.stringify(patch.metadata || {}),
        ],
    );
    return rows[0] || null;
};

const setPublishing = async (
    id,
    { workspace, coverageStore, layerName, styleName } = {},
    client = db,
) => {
    const { rows } = await client.query(
        `UPDATE gis.flood_artifacts SET
            publish_status  = 'publishing',
            workspace       = COALESCE($2, workspace),
            coverage_store  = COALESCE($3, coverage_store),
            layer_name      = COALESCE($4, layer_name),
            style_name      = COALESCE($5, style_name)
          WHERE id = $1
          RETURNING *`,
        [id, workspace || null, coverageStore || null, layerName || null, styleName || null],
    );
    return rows[0] || null;
};

const setPublished = async (id, client = db) => {
    const { rows } = await client.query(
        `UPDATE gis.flood_artifacts SET
            publish_status = 'published',
            published_at   = NOW()
          WHERE id = $1
          RETURNING *`,
        [id],
    );
    return rows[0] || null;
};

const setPublishFailed = async (id, _reason = null, client = db) => {
    const { rows } = await client.query(
        `UPDATE gis.flood_artifacts SET
            publish_status = 'failed',
            published_at   = NULL
          WHERE id = $1
          RETURNING *`,
        [id],
    );
    return rows[0] || null;
};

const setUnpublished = async (id, client = db) => {
    const { rows } = await client.query(
        `UPDATE gis.flood_artifacts SET
            publish_status = 'unpublished',
            published_at   = NULL
          WHERE id = $1
          RETURNING *`,
        [id],
    );
    return rows[0] || null;
};

module.exports = {
    PUBLISH_STATUSES,
    ARTIFACT_ROLES,
    findById,
    listByRunId,
    findByLayerName,
    listPublished,
    createForRun,
    updateAssetMetadata,
    setPublishing,
    setPublished,
    setPublishFailed,
    setUnpublished,
};
