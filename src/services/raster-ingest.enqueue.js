'use strict';

/**
 * Raster ingest — enqueue.
 *
 * Validates input, hashes the source URL, and INSERTs a `pending` row in
 * `raster_ingest_jobs` under a per-layer advisory lock. Dedupes:
 *   - by source URL hash (returns existing active job) — fast path
 *   - by layer_code inside the transaction (catches distinct URLs racing for
 *     the same layer target)
 *
 * @ported-from migration/kt_gee_migration/services/raster-ingest.enqueue.js
 * @improvement Injectable db / repo so unit tests don't need Postgres.
 * @improvement Uses cryptoHelper.hashToken() instead of a bespoke sha256Hex.
 * @improvement Drops the reference project's isS3Configured() gate — this
 *              server publishes rasters via the GeoServer FileSystem mirror
 *              (see architecture doc §41), not gs-s3-geotiff.
 */

const cfg = require('../configs/raster-ingest');
const { Api400Error, Api503Error } = require('../core/error.response');
const { t } = require('../utils/i18n.util');
const { hashToken } = require('../utils/cryptoHelper.util');

const DEBUG = process.env.RASTER_INGEST_DEBUG === 'true' || process.env.NODE_ENV === 'development';
const dbg = (msg) => {
    if (DEBUG) {
        console.debug(`[RASTER-INGEST:ENQUEUE] ${msg}`);
    }
};

/**
 * Log-safe URL — never emits the query string (which may carry GEE tokens).
 */
function safeUrl(url) {
    if (!url) {
        return '';
    }
    try {
        const u = new URL(url);
        return `${u.protocol}//${u.host}${u.pathname.slice(0, 40)}…`;
    } catch {
        return `${String(url).slice(0, 60)}…`;
    }
}

const VALID_LAYER_CODE = /^[a-z][a-z0-9_-]{1,58}$/i;
const VALID_URL = /^https?:\/\//i;

function requireConfig(lang) {
    if (!cfg.isEnabled()) {
        throw new Api503Error(t('raster_ingest_disabled', lang), ['MAP_UPDATE_DISABLED']);
    }
}

function validateInput({ sourceUrl, layerCode, lang }) {
    if (!sourceUrl || !VALID_URL.test(sourceUrl)) {
        throw new Api400Error(t('raster_ingest_invalid_url', lang), ['INVALID_SOURCE_URL']);
    }
    if (!layerCode || !VALID_LAYER_CODE.test(layerCode)) {
        throw new Api400Error(t('raster_ingest_invalid_layer_code', lang), ['INVALID_LAYER_CODE']);
    }
}

function loadDefaults() {
    let db = null;
    let repo = null;
    try {
        db = require('../configs/database');
    } catch {
        /* db module missing → tests without Postgres */
    }
    try {
        repo = require('../repositories/raster-ingest.repository');
    } catch {
        /* repo not shipped yet (pre-GEE-S05) */
    }
    return { db, repo };
}

/**
 * @param {object} args
 * @param {string} args.sourceUrl        — GEE download URL (zip GeoTIFF)
 * @param {string} args.layerCode        — layer target in gis.layer_registry
 * @param {string} [args.nameVi]
 * @param {string} [args.nameEn]
 * @param {boolean} [args.isPublic=false]
 * @param {string} [args.category='remote_sensing']
 * @param {object} [args.requestParams]  — bbox, epsg_code, scale_m, gee_map_id…
 * @param {object} args.user             — { id, ... }
 * @param {string} [args.lang='vi']
 * @param {object} [opts]
 * @param {object} [opts.db]             — override configs/database (test DI)
 * @param {object} [opts.repo]           — override raster-ingest.repository (test DI)
 * @returns {Promise<{ job, deduplicated }>}
 */
async function enqueue(args, opts = {}) {
    const {
        sourceUrl,
        layerCode,
        nameVi,
        nameEn,
        isPublic,
        category,
        requestParams = {},
        sourceKind = 'gee_download_url',
        user,
        lang = 'vi',
    } = args || {};
    const dbOverridden = 'db' in opts;
    const repoOverridden = 'repo' in opts;
    const defaults = dbOverridden && repoOverridden ? { db: null, repo: null } : loadDefaults();
    const db = dbOverridden ? opts.db : defaults.db;
    const rasterRepo = repoOverridden ? opts.repo : defaults.repo;

    requireConfig(lang);
    validateInput({ sourceUrl, layerCode, lang });

    if (!rasterRepo) {
        throw new Api503Error('raster_ingest_jobs repository not yet installed on this server', [
            'MAP_STORAGE_NOT_READY',
        ]);
    }
    if (!db?.pool?.connect) {
        throw new Api503Error('Database pool is not available for raster-ingest.enqueue', [
            'DB_UNAVAILABLE',
        ]);
    }

    const sourceHash = hashToken(sourceUrl);
    dbg(
        `layer=${layerCode} hash=${sourceHash.slice(0, 12)}… ` +
            `url=${safeUrl(sourceUrl)} user=${user?.id || 'anon'}`,
    );

    // Fast path — global dedupe by URL hash.
    const existing = await rasterRepo.findActiveBySourceHash(sourceHash);
    if (existing) {
        console.info(
            `[RASTER-INGEST] DEDUPE hit → job=${existing.id} status=${existing.status} layer=${layerCode}`,
        );
        return { job: existing, deduplicated: true };
    }

    const client = await db.pool.connect();
    try {
        await client.query('BEGIN');
        // Advisory lock keyed by layer_code so concurrent requests targeting
        // the same layer don't both INSERT a job.
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [layerCode]);

        const activeLayerJob = await rasterRepo.findActiveByLayerCode(layerCode, client);
        if (activeLayerJob) {
            await client.query('COMMIT');
            console.info(
                `[RASTER-INGEST] DEDUPE layer → job=${activeLayerJob.id} ` +
                    `status=${activeLayerJob.status} layer=${layerCode}`,
            );
            return { job: activeLayerJob, deduplicated: true };
        }

        const job = await rasterRepo.insertJob(client, {
            layerCode,
            sourceKind,
            sourceUrl,
            sourceHash,
            requestParams: {
                ...requestParams,
                nameVi: nameVi || null,
                nameEn: nameEn || null,
                isPublic: isPublic ?? false,
                category: category || 'remote_sensing',
            },
            createdBy: user?.id || null,
        });

        await client.query('COMMIT');
        console.info(
            `[RASTER-INGEST] ENQUEUED job=${job.id} layer=${layerCode} url=${safeUrl(sourceUrl)}`,
        );
        return { job, deduplicated: false };
    } catch (err) {
        try {
            await client.query('ROLLBACK');
        } catch {
            /* rollback failures shouldn't mask the original error */
        }
        // Partial UNIQUE violation → we lost a race; retry the hash lookup.
        if (err?.code === '23505') {
            const raced = await rasterRepo.findActiveBySourceHash(sourceHash);
            if (raced) {
                console.info(`[RASTER-INGEST] DEDUPE race → job=${raced.id} layer=${layerCode}`);
                return { job: raced, deduplicated: true };
            }
        }
        console.error(
            `[RASTER-INGEST] ENQUEUE FAILED layer=${layerCode} error=${err?.code || err?.name}: ${err?.message}`,
        );
        throw err;
    } finally {
        client.release();
    }
}

module.exports = { enqueue, safeUrl };
