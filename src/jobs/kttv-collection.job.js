'use strict';

const cron = require('node-cron');
const repository = require('../repositories/kttv.repository');
const service = require('../services/kttv.service');
const systemLogger = require('../utils/systemLogger.util');

const SYNC_CRON = process.env.KTTV_SCHEDULE_SYNC_CRON || '*/5 * * * *';
const tasks = new Map();
const running = new Map();
let syncTask = null;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const sourceKey = (sourceId) => String(sourceId);

const runSource = (sourceId) => {
    const key = sourceKey(sourceId);
    if (running.has(key)) {
        return running.get(key);
    }
    const work = (async () => {
        try {
            const source = await repository.findSource(sourceId);
            const attempts = Math.max(1, Number(source?.retry_count ?? 0) + 1);
            for (let attempt = 1; attempt <= attempts; attempt += 1) {
                try {
                    await service.collectSource(sourceId);
                    return;
                } catch (error) {
                    if (attempt < attempts) {
                        await sleep(Number(source?.retry_delay_sec ?? 60) * 1000);
                        continue;
                    }
                    console.error(`[KTTV] Source ${sourceId} collection failed:`, error.message);
                    systemLogger.logError('kttv', 'kttv_automatic_collection_failed', {
                        sourceId,
                        attempts,
                        errorCode: error.errors?.[0] || error.code || null,
                    });
                }
            }
        } finally {
            running.delete(key);
        }
    })();
    running.set(key, work);
    return work;
};

const sync = async () => {
    const sources = await repository.listScheduledSources();
    const desired = new Map(sources.map((source) => [sourceKey(source.id), source]));
    for (const [id, entry] of tasks) {
        const source = desired.get(id);
        if (!source || source.cron_expr !== entry.cron) {
            entry.task.stop();
            tasks.delete(id);
        }
    }
    for (const source of sources) {
        const id = sourceKey(source.id);
        if (tasks.has(id)) {
            continue;
        }
        if (!cron.validate(source.cron_expr)) {
            systemLogger.logWarn('kttv', 'kttv_source_invalid_cron', { sourceId: source.id });
            continue;
        }
        const task = cron.schedule(source.cron_expr, () => runSource(source.id), {
            noOverlap: true,
            missedExecutionTolerance: 30000,
        });
        tasks.set(id, { cron: source.cron_expr, task });
    }
};

const start = () => {
    if (syncTask || process.env.KTTV_COLLECTION_ENABLED !== 'true') {
        return;
    }
    if (!cron.validate(SYNC_CRON)) {
        console.warn(`[KTTV] Invalid sync cron "${SYNC_CRON}" — scheduler not started`);
        return;
    }
    sync().catch((error) => console.error('[KTTV] Initial schedule sync failed:', error.message));
    syncTask = cron.schedule(SYNC_CRON, () =>
        sync().catch((error) => console.error('[KTTV] Schedule sync failed:', error.message)),
    );
    console.log(`  ✓ KTTV collection scheduler started (${SYNC_CRON})`);
};

const stop = async () => {
    if (syncTask) {
        syncTask.stop();
    }
    syncTask = null;
    for (const entry of tasks.values()) {
        entry.task.stop();
    }
    tasks.clear();
    await Promise.allSettled([...running.values()]);
};

module.exports = { start, stop, sync, runSource };
