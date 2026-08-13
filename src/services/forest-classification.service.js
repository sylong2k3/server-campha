'use strict';

const queue = require('../queues/gee-task.queue');
const snapshots = require('../repositories/forest-classification.repository');

const activeStatuses = new Set(['pending', 'computing', 'exporting']);

const periodDates = (year, month) => {
    const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
    const end = new Date(Date.UTC(year, month, 0));
    return { startDate, endDate: end.toISOString().slice(0, 10) };
};

async function executeRun(snapshot) {
    await snapshots.updateRun(snapshot.id, { status: 'computing', errorMessage: null });
    try {
        // The former Kon Tum project ran a model-specific pipeline here. Cẩm Phả
        // keeps the same durable snapshot contract, but builds the current AOI
        // classification through the shared GEE satellite engine.
        const satellite = require('./satellite.service');
        const { startDate, endDate } = periodDates(snapshot.year, snapshot.month);
        const result = await satellite.getClassified({ startDate, endDate, collection: 'AUTO' });
        return snapshots.updateRun(snapshot.id, {
            status: 'completed',
            geeTileUrl: result.geeTileUrl,
            geeDownloadUrl: result.downloadUrl,
            provinceSummary: {
                byClass: result.stats?.areaByClass || {},
                totalHa: result.stats?.totalHa || null,
                source: 'gee-on-demand-classified',
            },
            computedAt: new Date(),
        });
    } catch (error) {
        await snapshots.updateRun(snapshot.id, {
            status: 'failed',
            errorMessage: String(error?.message || 'Forest classification failed').slice(0, 1000),
            computedAt: new Date(),
        });
        throw error;
    }
}

async function requestRun({ year, month, trigger, requestedBy }) {
    const created = await snapshots.createRun({ year, month, trigger, requestedBy });
    const key = `analysis:forest-classification:${year}-${String(month).padStart(2, '0')}`;
    if (!created.deduplicated) {
        queue.enqueue({
            key,
            label: `Forest classification ${year}-${String(month).padStart(2, '0')}`,
            run: () => executeRun(created.snapshot),
        }).catch((error) => {
            console.error(`[FOREST] ${year}/${month} failed: ${error.message}`);
        });
    }
    return { ...created, taskKey: key };
}

async function getLatest() {
    const latestCompleted = await snapshots.getLatestCompleted();
    const newest = await snapshots.getLatest();
    const snapshot = latestCompleted || newest || null;
    const districtAreas = snapshot && ['completed', 'published'].includes(snapshot.status)
        ? await snapshots.getDistrictAreas(snapshot.id)
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

async function getSnapshot(id) {
    const snapshot = await snapshots.getById(id);
    if (!snapshot) {return null;}
    return {
        snapshot,
        districtAreas: ['completed', 'published'].includes(snapshot.status)
            ? await snapshots.getDistrictAreas(snapshot.id)
            : [],
        comparison: null,
    };
}

async function queryPeriod(year, month, requestedBy) {
    const existing = await snapshots.getByPeriod(year, month);
    if (existing && ['completed', 'published'].includes(existing.status)) {
        return {
            snapshot: existing,
            districtAreas: await snapshots.getDistrictAreas(existing.id),
            comparison: null,
            cached: true,
            computing: false,
        };
    }
    const run = existing && activeStatuses.has(existing.status)
        ? { snapshot: existing, deduplicated: true }
        : await requestRun({ year, month, trigger: 'user', requestedBy });
    return { snapshot: run.snapshot, districtAreas: [], comparison: null, cached: false, computing: true };
}

module.exports = {
    activeStatuses,
    requestRun,
    getLatest,
    getSnapshot,
    queryPeriod,
    listRuns: snapshots.listRuns,
    getDistrictExports: snapshots.listDistrictExports,
};
