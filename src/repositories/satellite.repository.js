'use strict';

const db = require('../configs/database');

const CACHE_TTL_MS = Math.max(
    60 * 1000,
    Number.parseInt(process.env.SATELLITE_CACHE_TTL_MS, 10) || 6 * 60 * 60 * 1000,
);

const getByHash = async (requestHash) => {
    const { rows } = await db.query(
        `SELECT * FROM satellite.image_results
         WHERE request_hash = $1 AND expires_at > NOW()
         LIMIT 1`,
        [requestHash],
    );
    return rows[0] || null;
};

const getById = async (id) => {
    const { rows } = await db.query('SELECT * FROM satellite.image_results WHERE id = $1', [id]);
    return rows[0] || null;
};

const upsert = async ({
    requestHash,
    imageType,
    collection,
    startDate,
    endDate,
    geometry,
    tileUrl,
    mapId,
    stats = {},
    legend = [],
    metadata = {},
}) => {
    const expiresAt = new Date(Date.now() + CACHE_TTL_MS);
    const { rows } = await db.query(
        `INSERT INTO satellite.image_results
            (request_hash, image_type, collection, start_date, end_date, geometry,
             tile_url, map_id, stats, legend, metadata, expires_at)
         VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9::jsonb,$10::jsonb,$11::jsonb,$12)
         ON CONFLICT (request_hash) DO UPDATE SET
             collection = EXCLUDED.collection,
             start_date = EXCLUDED.start_date,
             end_date = EXCLUDED.end_date,
             geometry = EXCLUDED.geometry,
             tile_url = EXCLUDED.tile_url,
             map_id = EXCLUDED.map_id,
             stats = EXCLUDED.stats,
             legend = EXCLUDED.legend,
             metadata = EXCLUDED.metadata,
             expires_at = EXCLUDED.expires_at,
             status = 'ready',
             publish_error = NULL
         RETURNING *`,
        [
            requestHash,
            imageType,
            collection || null,
            startDate,
            endDate,
            JSON.stringify(geometry),
            tileUrl,
            mapId || null,
            JSON.stringify(stats),
            JSON.stringify(legend),
            JSON.stringify(metadata),
            expiresAt,
        ],
    );
    return rows[0];
};

const updatePublish = async (id, patch = {}) => {
    const { status, geeTaskId, minioKey, geoserverLayer, geoserverStore, publishError } = patch;
    const { rows } = await db.query(
        `UPDATE satellite.image_results
            SET status = COALESCE($2, status),
                gee_task_id = COALESCE($3, gee_task_id),
                minio_key = COALESCE($4, minio_key),
                geoserver_layer = COALESCE($5, geoserver_layer),
                geoserver_store = COALESCE($6, geoserver_store),
                publish_error = $7
          WHERE id = $1
          RETURNING *`,
        [id, status, geeTaskId, minioKey, geoserverLayer, geoserverStore, publishError || null],
    );
    return rows[0] || null;
};

module.exports = { CACHE_TTL_MS, getByHash, getById, upsert, updatePublish };
