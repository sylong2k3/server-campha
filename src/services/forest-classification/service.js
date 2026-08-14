'use strict';

const queue = require('../../queues/gee-task.queue');
const snapshots = require('../../repositories/forest-classification.repository');
const { periodDates } = require('./period');
const { queueSnapshotArchive } = require('./archive');
const { CAM_PHA_GEOMETRY } = require('../satellite/geometry');

const activeStatuses = new Set(['pending', 'computing', 'exporting']);

const summaryFromResult = (result, archiveJob = null) => ({
    byClass: result.stats?.areaByClass || {},
    totalHa: result.stats?.totalHa || null,
    classSchema: 'campha_landcover_12',
    source: 'campha-sentinel2-rule-based-v1',
    rasterIngestJobId: archiveJob?.job?.id || null,
});

async function executeRun(snapshot, deps = {}) {
    const repo = deps.repository || snapshots;
    const satellite = deps.satellite || require('../satellite');
    const archive = deps.queueArchive || queueSnapshotArchive;
    await repo.updateRun(snapshot.id, { status: 'computing', errorMessage: null });
    try {
        const { startDate, endDate } = periodDates(snapshot.year, snapshot.month);
        const result = await satellite.getClassified({
            startDate,
            endDate,
            collection: 'AUTO',
            geometry: CAM_PHA_GEOMETRY,
        });
        let archiveJob = null;
        try {
            archiveJob = await archive(snapshot, result);
        } catch (error) {
            // Keep the interactive GEE result available; admins can retry
            // publication instead of losing a completed classification.
            console.error(
                `[FOREST] archive enqueue failed for snapshot=${snapshot.id}: ${error.message}`,
            );
        }
        return repo.updateRun(snapshot.id, {
            status: archiveJob ? 'exporting' : 'completed',
            geeTileUrl: result.geeTileUrl,
            geeDownloadUrl: result.downloadUrl,
            provinceSummary: summaryFromResult(result, archiveJob),
            computedAt: new Date(),
        });
    } catch (error) {
        await repo.updateRun(snapshot.id, {
            status: 'failed',
            errorMessage: String(error?.message || 'Forest classification failed').slice(0, 1000),
            computedAt: new Date(),
        });
        throw error;
    }
}

async function requestRun({ year, month, trigger, requestedBy }, deps = {}) {
    const repo = deps.repository || snapshots;
    const taskQueue = deps.queue || queue;
    const created = await repo.createRun({ year, month, trigger, requestedBy });
    const taskKey = `analysis:forest-classification:${year}-${String(month).padStart(2, '0')}`;
    if (!created.deduplicated) {
        taskQueue
            .enqueue({
                key: taskKey,
                label: `Forest classification ${year}-${String(month).padStart(2, '0')}`,
                run: () => executeRun(created.snapshot, deps),
            })
            .catch((error) => console.error(`[FOREST] ${year}/${month} failed: ${error.message}`));
    }
    return { ...created, taskKey };
}

async function getLatest(deps = {}) {
    const repo = deps.repository || snapshots;
    const latestCompleted = await repo.getLatestCompleted();
    const newest = await repo.getLatest();
    const snapshot = latestCompleted || newest || null;
    const districtAreas =
        snapshot && ['completed', 'published'].includes(snapshot.status)
            ? await repo.getDistrictAreas(snapshot.id)
            : [];
    return {
        snapshot,
        processingSnapshot: newest || snapshot,
        districtAreas,
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
        districtAreas: ['completed', 'published'].includes(snapshot.status)
            ? await repo.getDistrictAreas(snapshot.id)
            : [],
        comparison: null,
    };
}

async function queryPeriod(year, month, requestedBy, deps = {}) {
    const repo = deps.repository || snapshots;
    const existing = await repo.getByPeriod(year, month);
    if (existing && ['completed', 'published'].includes(existing.status)) {
        return {
            snapshot: existing,
            districtAreas: await repo.getDistrictAreas(existing.id),
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
        districtAreas: [],
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
    getDistrictExports: snapshots.listDistrictExports,
};
