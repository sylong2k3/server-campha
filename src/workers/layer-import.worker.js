'use strict';

process.env.TZ = process.env.TZ || 'Asia/Ho_Chi_Minh';
require('dotenv').config();

const crypto = require('crypto');
const db = require('../configs/database');
const jobRepository = require('../repositories/layer-job.repository');
const layerRepository = require('../repositories/layer.repository');
const storageRepository = require('../repositories/storage.repository');
const minioService = require('../services/minio.service');
const geoserverClient = require('../utils/geoserver.client');
const { GeoServerError } = geoserverClient;
const { executeImport, LayerImportValidationError, quoteIdentifier } = require('../services/gdal-import.service');

const workerId = `${process.env.HOSTNAME || 'layer-worker'}-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
const pollMs = Math.max(250, Number(process.env.LAYER_WORKER_POLL_MS || 1500));
const leaseSeconds = Math.max(30, Number(process.env.LAYER_WORKER_LEASE_SECONDS || 120));
let stopping = false;
let currentJob = null;

const delay = (ms) => new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    if (stopping) { timer.unref?.(); }
});

const processImport = async (job) => {
    currentJob = { type: 'import', id: job.id };
    const { rows: [file] } = await db.query(
        `SELECT object_key FROM core.file_objects
         WHERE id = $1 AND category = 'layers' AND lifecycle_status = 'ready'
           AND scan_status = 'clean' AND deleted_at IS NULL`, [job.file_object_id]
    );
    if (!file) {
        await jobRepository.failImport(job.id, workerId, 'SOURCE_FILE_NOT_READY', 'Source file is unavailable');
        currentJob = null;
        return;
    }
    const heartbeat = setInterval(() => {
        jobRepository.heartbeatImport(job.id, workerId, 25, leaseSeconds).catch((error) => console.error('[LayerWorker] heartbeat:', error.message));
    }, Math.max(10000, Math.floor(leaseSeconds * 500)));
    heartbeat.unref?.();
    try {
        await executeImport({ ...job, object_key: file.object_key });
    } catch (error) {
        if (error instanceof LayerImportValidationError && error.importErrors?.length) {
            await jobRepository.addImportErrors(job.id, workerId, error.importErrors);
        }
        await jobRepository.failImport(job.id, workerId, error.code || 'IMPORT_FAILED', error.message || 'Import failed');
    } finally {
        clearInterval(heartbeat);
        currentJob = null;
    }
};

const isAlreadyGone = (error) => error instanceof GeoServerError && error.status === 404;
const processCleanup = async (job) => {
    currentJob = { type: 'cleanup', id: job.id };
    const heartbeat = setInterval(() => {
        jobRepository.heartbeatCleanup(job.id, workerId, leaseSeconds)
            .catch((error) => console.error('[LayerWorker] cleanup heartbeat:', error.message));
    }, Math.max(10000, Math.floor(leaseSeconds * 500)));
    heartbeat.unref?.();
    try {
        const layer = await layerRepository.findById(job.layer_id, true);
        if (!layer) { throw new Error('Layer metadata not found'); }
        if (layer.geoserver_layer) {
            try { await geoserverClient.unpublishLayer(layer.geoserver_layer); }
            catch (error) { if (!isAlreadyGone(error)) { throw error; } }
        }
        if (layer.storage_kind === 'postgis' && layer.table_name) {
            await db.query(`DROP TABLE IF EXISTS gis.${quoteIdentifier(layer.table_name)}`);
        }
        if (layer.source_file_id) {
            const { rows: [file] } = await db.query(
                `SELECT id, object_key FROM core.file_objects
                 WHERE id = $1 AND deleted_at IS NULL`, [layer.source_file_id]
            );
            if (file) {
                await minioService.removeObject({ objectKey: file.object_key, category: 'layers' }).catch((error) => {
                    if (!['NoSuchKey', 'NoSuchObject', 'NotFound'].includes(error.code)) { throw error; }
                });
                await storageRepository.markDeleted(file.id, layer.created_by);
            }
        }
        const completed = await jobRepository.completeCleanup(job.id, workerId, job.layer_id);
        if (!completed) { console.warn('[LayerWorker] cleanup lease lost before completion'); }
    } catch (error) {
        const failed = await jobRepository.failCleanup(job, workerId, error.message || 'Cleanup failed');
        if (!failed) { console.warn('[LayerWorker] cleanup lease lost before failure update'); }
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
            if (cleanup) { await processCleanup(cleanup); continue; }
            const job = await jobRepository.claimImport(workerId, leaseSeconds);
            if (job) { await processImport(job); continue; }
        } catch (error) {
            console.error('[LayerWorker] poll failed:', error.message);
        }
        if (!stopping) { await delay(pollMs); }
    }
    db.stopPoolMonitor();
    await db.pool.end();
    process.send?.({ type: 'stopped', currentJob });
};

const stop = () => { stopping = true; };
process.on('message', (message) => { if (message?.type === 'stop') { stop(); } });
process.on('SIGTERM', stop);
process.on('SIGINT', stop);

loop().then(() => process.exit(0)).catch((error) => {
    console.error('[LayerWorker] fatal:', error.stack || error.message);
    process.exit(1);
});
