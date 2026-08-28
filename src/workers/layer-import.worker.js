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
const safeSegment = (value) => /^[a-z0-9_-]+$/i.test(value || '');
const coverageStoreForLayer = (layer) => {
    const store =
        layer.metadata?.geoserverStore ||
        String(layer.geoserver_layer || '')
            .split(':')
            .at(-1);
    return safeSegment(store) ? store : null;
};
const removeGeoServerMirror = async (storeName, publishCategory) => {
    const dataDir = process.env.GEOSERVER_DATA_DIR;
    const category = safeSegment(publishCategory) ? publishCategory : null;
    if (!dataDir || !safeSegment(storeName) || !category) {
        return false;
    }
    const root = path.resolve(dataDir);
    const mirrorPath = path.resolve(root, category, `${storeName}.tif`);
    if (
        path.relative(root, mirrorPath).startsWith('..') ||
        path.isAbsolute(path.relative(root, mirrorPath))
    ) {
        throw new Error('GeoServer mirror path escapes GEOSERVER_DATA_DIR');
    }
    await fs.promises.rm(mirrorPath, { force: true });
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
            if (storeName) {
                try {
                    await geoserver.deleteCoverageStore(storeName);
                } catch (error) {
                    if (!isAlreadyGone(error)) {
                        throw error;
                    }
                }
            }
            const artifact = await layers.findRasterIngestArtifact?.(layer);
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
