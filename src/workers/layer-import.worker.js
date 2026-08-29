'use strict';

process.env.TZ = process.env.TZ || 'Asia/Ho_Chi_Minh';
require('dotenv').config();

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const db = require('../configs/database');
const jobRepository = require('../repositories/layer-job.repository');
const layerRepository = require('../repositories/layer.repository');
const fileCleanupWorker = require('./file-cleanup.worker');
const geoserverClient = require('../utils/geoserver.client');
const { GeoServerError } = geoserverClient;
const {
    executeImport,
    LayerImportValidationError,
    quoteIdentifier,
} = require('../services/gdal-import.service');

const workerId = `${process.env.HOSTNAME || 'layer-worker'}-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
const pollMs = Math.max(250, Number(process.env.LAYER_WORKER_POLL_MS || 1500));
const leaseSeconds = Math.max(30, Number(process.env.LAYER_WORKER_LEASE_SECONDS || 120));
let stopping = false;
let currentJob = null;

const delay = (ms) =>
    new Promise((resolve) => {
        const timer = setTimeout(resolve, ms);
        if (stopping) {
            timer.unref?.();
        }
    });

const processImport = async (job) => {
    currentJob = { type: 'import', id: job.id };
    const {
        rows: [file],
    } = await db.query(
        `SELECT object_key FROM core.file_objects
         WHERE id = $1 AND category = 'layers' AND lifecycle_status = 'ready'
           AND scan_status = 'clean' AND deleted_at IS NULL`,
        [job.file_object_id],
    );
    if (!file) {
        await jobRepository.failImport(
            job.id,
            workerId,
            'SOURCE_FILE_NOT_READY',
            'Source file is unavailable',
        );
        currentJob = null;
        return;
    }
    const heartbeat = setInterval(
        () => {
            jobRepository
                .heartbeatImport(job.id, workerId, 25, leaseSeconds)
                .catch((error) => console.error('[LayerWorker] heartbeat:', error.message));
        },
        Math.max(10000, Math.floor(leaseSeconds * 500)),
    );
    heartbeat.unref?.();
    try {
        await executeImport({ ...job, object_key: file.object_key });
    } catch (error) {
        if (error instanceof LayerImportValidationError && error.importErrors?.length) {
            await jobRepository.addImportErrors(job.id, workerId, error.importErrors);
        }
        await jobRepository.failImport(
            job.id,
            workerId,
            error.code || 'IMPORT_FAILED',
            error.message || 'Import failed',
        );
    } finally {
        clearInterval(heartbeat);
        currentJob = null;
    }
};

const isAlreadyGone = (error) => error instanceof GeoServerError && error.status === 404;
const safePathSegment = (value) => typeof value === 'string' && /^[a-z0-9_-]{1,80}$/i.test(value);
const safeStoreName = (value) => typeof value === 'string' && /^[a-z][a-z0-9_-]{0,79}$/.test(value);
const coverageStoreForLayer = (layer) => {
    const metadataStore = layer.metadata?.geoserverStore;
    if (metadataStore !== undefined && metadataStore !== null) {
        return safeStoreName(metadataStore) ? metadataStore : null;
    }
    const parts = typeof layer.geoserver_layer === 'string' ? layer.geoserver_layer.split(':') : [];
    return parts.length === 2 && safeStoreName(parts[1]) ? parts[1] : null;
};
const removeGeoServerMirror = async (storeName, publishCategory, deps = {}) => {
    const fsPromises = deps.fsPromises || fs.promises;
    const pathApi = deps.path || path;
    const dataDir = process.env.GEOSERVER_DATA_DIR;
    const category = safePathSegment(publishCategory) ? publishCategory : null;
    if (!dataDir || !safeStoreName(storeName) || !category) {
        return false;
    }
    let root;
    try {
        root = await fsPromises.realpath(dataDir);
    } catch (error) {
        if (error.code === 'ENOENT') {
            return false;
        }
        throw error;
    }
    const categoryPath = pathApi.resolve(root, category);
    const mirrorPath = pathApi.resolve(categoryPath, `${storeName}.tif`);
    const relative = pathApi.relative(root, mirrorPath);
    if (relative.startsWith('..') || pathApi.isAbsolute(relative)) {
        throw new Error('GeoServer mirror path escapes GEOSERVER_DATA_DIR');
    }
    let categoryStat;
    try {
        categoryStat = await fsPromises.lstat(categoryPath);
    } catch (error) {
        if (error.code === 'ENOENT') {
            return false;
        }
        throw error;
    }
    if (!categoryStat.isDirectory() || categoryStat.isSymbolicLink()) {
        throw new Error('GeoServer mirror category is not a real directory');
    }
    await fsPromises.rm(mirrorPath, { force: true });
    return true;
};
const processCleanup = async (job, deps = {}) => {
    const jobs = deps.jobRepository || jobRepository;
    const layers = deps.layerRepository || layerRepository;
    const geoserver = deps.geoserverClient || geoserverClient;
    const removeMirror = deps.removeGeoServerMirror || removeGeoServerMirror;
    currentJob = { type: 'cleanup', id: job.id };
    const heartbeat = setInterval(
        () => {
            jobs.heartbeatCleanup(job.id, workerId, leaseSeconds).catch((error) =>
                console.error('[LayerWorker] cleanup heartbeat:', error.message),
            );
        },
        Math.max(10000, Math.floor(leaseSeconds * 500)),
    );
    heartbeat.unref?.();
    try {
        const layer = await layers.findById(job.layer_id, true);
        if (!layer) {
            throw new Error('Layer metadata not found');
        }
        if (layer.geoserver_layer) {
            try {
                await geoserver.unpublishLayer(layer.geoserver_layer);
            } catch (error) {
                if (!isAlreadyGone(error)) {
                    throw error;
                }
            }
        }
        if (layer.storage_kind === 'geotiff_minio') {
            const storeName = coverageStoreForLayer(layer);
            const [artifact, mosaic] = await Promise.all([
                layers.findRasterIngestArtifact?.(layer),
                layers.findImageMosaicArtifact?.(layer),
            ]);
            if (storeName && (layer.source_file_id || artifact || mosaic)) {
                try {
                    if (mosaic) {
                        await geoserver.deleteCoverageStore(storeName, 'all');
                    } else {
                        await geoserver.deleteCoverageStore(storeName);
                    }
                } catch (error) {
                    if (!isAlreadyGone(error)) {
                        throw error;
                    }
                }
            }
            if (artifact && storeName) {
                await removeMirror(storeName, artifact.geoserverPublishCategory);
            }
        }
        if (layer.storage_kind === 'postgis' && layer.table_name) {
            await db.query(`DROP TABLE IF EXISTS gis.${quoteIdentifier(layer.table_name)}`);
        }
        const completed = await jobs.completeCleanup(job.id, workerId, job.layer_id);
        if (!completed) {
            console.warn('[LayerWorker] cleanup lease lost before completion');
        }
    } catch (error) {
        const failed = await jobs.failCleanup(job, workerId, error.message || 'Cleanup failed');
        if (!failed) {
            console.warn('[LayerWorker] cleanup lease lost before failure update');
        }
    } finally {
        clearInterval(heartbeat);
        currentJob = null;
    }
};

const loop = async () => {
    console.log(`[LayerWorker] started ${workerId}`);
    while (!stopping) {
        try {
            const cleanup = await jobRepository.claimCleanup(workerId, leaseSeconds);
            if (cleanup) {
                await processCleanup(cleanup);
                continue;
            }
            if (await fileCleanupWorker.claimAndProcess()) {
                continue;
            }
            const job = await jobRepository.claimImport(workerId, leaseSeconds);
            if (job) {
                await processImport(job);
                continue;
            }
        } catch (error) {
            console.error('[LayerWorker] poll failed:', error.message);
        }
        if (!stopping) {
            await delay(pollMs);
        }
    }
    db.stopPoolMonitor();
    await db.pool.end();
    process.send?.({ type: 'stopped', currentJob });
};

const stop = () => {
    stopping = true;
};
process.on('message', (message) => {
    if (message?.type === 'stop') {
        stop();
    }
});
process.on('SIGTERM', stop);
process.on('SIGINT', stop);

if (require.main === module) {
    loop()
        .then(() => process.exit(0))
        .catch((error) => {
            console.error('[LayerWorker] fatal:', error.stack || error.message);
            process.exit(1);
        });
}

module.exports = {
    processCleanup,
    coverageStoreForLayer,
    removeGeoServerMirror,
};
