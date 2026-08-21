'use strict';

const queue = require('../../queues/gee-task.queue');
const snapshots = require('../../repositories/forest-classification.repository');
const { periodDates } = require('./period');
const { queueSnapshotArchive } = require('./archive');
const { CAM_PHA_GEOMETRY } = require('../satellite/geometry');
const { buildLegend, summariseCoverage } = require('./pipeline');
const debug = require('./debug.util');

const activeStatuses = new Set(['pending', 'computing', 'exporting']);

const summaryFromResult = (result, archiveJob = null) => {
    const areaByClass = result.stats?.areaByClass || {};
    const totalHa = Number(result.stats?.totalHa) || 0;
    const coverage = summariseCoverage(areaByClass, totalHa);
    return {
        byClass: areaByClass,
        totalHa: totalHa || null,
        ...coverage,
        legend: buildLegend(areaByClass, totalHa),
        classSchema: 'campha_landcover_8',
        source: 'campha-sentinel2-rule-based-v1',
        rasterIngestJobId: archiveJob?.job?.id || null,
    };
};

async function executeRun(snapshot, deps = {}) {
    const repo = deps.repository || snapshots;
    const satellite = deps.satellite || require('../satellite');
    const archive = deps.queueArchive || queueSnapshotArchive;
    const modelParams = snapshot.model_params || {};
    const cloudCover = Number.isFinite(Number(modelParams.cloudCover))
        ? Number(modelParams.cloudCover)
        : undefined;
    debug.log('service.executeRun start', {
        snapshotId: snapshot.id,
        year: snapshot.year,
        month: snapshot.month,
        attempt: snapshot.attempt,
        trigger: snapshot.trigger,
        cloudCover: cloudCover ?? '(default)',
    });
    await repo.updateRun(snapshot.id, { status: 'computing', errorMessage: null });
    debug.log('service.executeRun status=computing', { snapshotId: snapshot.id });
    try {
        const { startDate, endDate } = periodDates(snapshot.year, snapshot.month);
        debug.log('service.executeRun gee.getClassified start', {
            snapshotId: snapshot.id,
            startDate,
            endDate,
            cloudCover: cloudCover ?? '(default)',
        });
        const geeStart = Date.now();
        const result = await satellite.getClassified({
            startDate,
            endDate,
            collection: 'AUTO',
            geometry: CAM_PHA_GEOMETRY,
            ...(cloudCover !== undefined ? { cloudCover } : {}),
        });
        debug.log('service.executeRun gee.getClassified ok', {
            snapshotId: snapshot.id,
            elapsed_ms: Date.now() - geeStart,
            hasDownloadUrl: Boolean(result?.downloadUrl),
            hasTileUrl: Boolean(result?.geeTileUrl),
            totalHa: result?.stats?.totalHa || null,
        });
        let archiveJob = null;
        try {
            debug.log('service.executeRun archive.enqueue start', { snapshotId: snapshot.id });
            archiveJob = await archive(snapshot, result);
            debug.log('service.executeRun archive.enqueue done', {
                snapshotId: snapshot.id,
                queued: Boolean(archiveJob),
                jobId: archiveJob?.job?.id || null,
                layerCode: archiveJob?.layerCode || null,
            });
        } catch (error) {
            // Keep the interactive GEE result available; admins can retry
            // publication instead of losing a completed classification.
            debug.logError('service.executeRun archive.enqueue failed', error, {
                snapshotId: snapshot.id,
            });
            console.error(
                `[FOREST] archive enqueue failed for snapshot=${snapshot.id}: ${error.message}`,
            );
        }
        const finalStatus = archiveJob ? 'exporting' : 'completed';
        const s2ImageCount = Number.isFinite(Number(result?.stats?.s2Count))
            ? Number(result.stats.s2Count)
            : undefined;
        const lsImageCount = Number.isFinite(Number(result?.stats?.landsatCount))
            ? Number(result.stats.landsatCount)
            : undefined;
        const durationMs = Date.now() - geeStart;
        debug.log('service.executeRun finish', {
            snapshotId: snapshot.id,
            status: finalStatus,
            s2ImageCount,
            lsImageCount,
            durationMs,
        });
        return repo.updateRun(snapshot.id, {
            status: finalStatus,
            geeTileUrl: result.geeTileUrl,
            geeDownloadUrl: result.downloadUrl,
            provinceSummary: summaryFromResult(result, archiveJob),
            s2ImageCount,
            lsImageCount,
            durationMs,
            computedAt: new Date(),
        });
    } catch (error) {
        debug.logError('service.executeRun failed', error, { snapshotId: snapshot.id });
        await repo.updateRun(snapshot.id, {
            status: 'failed',
            errorMessage: String(error?.message || 'Forest classification failed').slice(0, 1000),
            computedAt: new Date(),
        });
        throw error;
    }
}

async function requestRun({ year, month, trigger, requestedBy, cloudCover }, deps = {}) {
    const repo = deps.repository || snapshots;
    const taskQueue = deps.queue || queue;
    const modelParams = {};
    if (Number.isFinite(Number(cloudCover))) {
        modelParams.cloudCover = Number(cloudCover);
    }
    debug.log('service.requestRun', { year, month, trigger, requestedBy, cloudCover });
    const created = await repo.createRun({ year, month, trigger, requestedBy, modelParams });
    const taskKey = `analysis:forest-classification:${year}-${String(month).padStart(2, '0')}`;
    if (created.deduplicated) {
        debug.log('service.requestRun deduplicated', {
            year,
            month,
            existingSnapshotId: created.snapshot?.id,
            existingStatus: created.snapshot?.status,
        });
    } else {
        debug.log('service.requestRun enqueue', {
            year,
            month,
            snapshotId: created.snapshot?.id,
            taskKey,
        });
        taskQueue
            .enqueue({
                key: taskKey,
                label: `Forest classification ${year}-${String(month).padStart(2, '0')}`,
                run: () => executeRun(created.snapshot, deps),
            })
            .catch((error) => {
                debug.logError('service.requestRun executeRun rejected', error, {
                    year,
                    month,
                    snapshotId: created.snapshot?.id,
                });
                console.error(`[FOREST] ${year}/${month} failed: ${error.message}`);
            });
    }
    return { ...created, taskKey };
}

async function getLatest(deps = {}) {
    const repo = deps.repository || snapshots;
    const latestCompleted = await repo.getLatestCompleted();
    const newest = await repo.getLatest();
    const snapshot = latestCompleted || newest || null;
    return {
        snapshot,
        processingSnapshot: newest || snapshot,
        comparison: null,
        stale: Boolean(latestCompleted && newest && newest.id !== latestCompleted.id),
        computing: Boolean(newest && activeStatuses.has(newest.status)),
    };
}

async function getSnapshot(id, deps = {}) {
    const repo = deps.repository || snapshots;
    const snapshot = await repo.getById(id);
    if (!snapshot) {
        return null;
    }
    return {
        snapshot,
        comparison: null,
    };
}

async function queryPeriod(year, month, requestedBy, deps = {}) {
    const repo = deps.repository || snapshots;
    const existing = await repo.getByPeriod(year, month);
    if (existing && ['completed', 'published'].includes(existing.status)) {
        return {
            snapshot: existing,
            comparison: null,
            cached: true,
            computing: false,
        };
    }
    const run =
        existing && activeStatuses.has(existing.status)
            ? { snapshot: existing, deduplicated: true }
            : await requestRun({ year, month, trigger: 'user', requestedBy }, deps);
    return {
        snapshot: run.snapshot,
        comparison: null,
        cached: false,
        computing: true,
    };
}

module.exports = {
    activeStatuses,
    executeRun,
    requestRun,
    getLatest,
    getSnapshot,
    queryPeriod,
    listRuns: snapshots.listRuns,
};
