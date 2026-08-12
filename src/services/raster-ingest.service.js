'use strict';

/**
 * Raster ingest — public facade.
 *
 * Re-exports the split modules (enqueue, runJob) and adds two thin read APIs
 * so controllers / admin diagnostics only need one require path:
 *
 *   raster-ingest.service.js    ← this file (facade + read APIs)
 *   raster-ingest.enqueue.js    ← validate + dedupe + INSERT
 *   raster-ingest.pipeline.js   ← 7-stage state machine (§22-F CRS gate)
 *   raster-ingest.retry.js      ← retry policy + §22-D DLQ terminal state
 *   raster-ingest.publish.js    ← GeoServer + layer_registry + flood back-link
 *
 * The current server publishes via the GeoServer FileSystem GeoTIFF mirror
 * (see architecture doc §41). The reference project's gs-s3-geotiff path was
 * intentionally not ported.
 *
 * @ported-from migration/kt_gee_migration/services/raster-ingest.service.js
 */

const { Api404Error } = require('../core/error.response');
const { t } = require('../utils/i18n.util');

const { enqueue } = require('./raster-ingest.enqueue');
const { runJob } = require('./raster-ingest.pipeline');

function safeRequireRepo() {
    try {
        return require('../repositories/raster-ingest.repository');
    } catch {
        return null;
    }
}

/**
 * @param {number} id
 * @param {string} [lang='vi']
 * @param {object} [deps]
 * @param {object} [deps.repo]
 */
async function getJobById(id, lang = 'vi', opts = {}) {
    const rasterRepo = 'repo' in opts ? opts.repo : safeRequireRepo();
    if (!rasterRepo?.findById) {
        throw new Error('raster-ingest.repository is not yet installed');
    }
    const job = await rasterRepo.findById(id);
    if (!job) {
        throw new Api404Error(t('raster_ingest_job_not_found', lang), ['JOB_NOT_FOUND']);
    }
    return job;
}

/**
 * @param {string} layerCode
 * @param {object} [query]
 * @param {number} [query.page=1]
 * @param {number} [query.limit=20]   — clamped 1..100
 * @param {object} [deps]
 * @param {object} [deps.repo]
 */
async function listJobsByLayer(layerCode, query = {}, opts = {}) {
    const rasterRepo = 'repo' in opts ? opts.repo : safeRequireRepo();
    if (!rasterRepo?.listByLayerCode) {
        throw new Error('raster-ingest.repository is not yet installed');
    }
    const limit = Math.min(Math.max(Number(query.limit) || 20, 1), 100);
    const page = Math.max(Number(query.page) || 1, 1);
    const offset = (page - 1) * limit;
    return rasterRepo.listByLayerCode(layerCode, { limit, offset });
}

module.exports = { enqueue, runJob, getJobById, listJobsByLayer };
