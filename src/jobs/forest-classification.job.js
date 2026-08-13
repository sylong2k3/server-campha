'use strict';

const cron = require('node-cron');
const forest = require('../services/forest-classification');
const snapshots = require('../repositories/forest-classification.repository');
const { previousCompletedPeriod } = require('../services/forest-classification/period');

let scheduledTask = null;
let catchupTimer = null;

const enabled = () => String(process.env.FC_ENABLED || 'true').toLowerCase() === 'true';
const cronExpression = () => process.env.FC_CRON || '0 0 1 * *';
const timezone = () => process.env.FC_CRON_TZ || 'Asia/Ho_Chi_Minh';
const catchupEnabled = () =>
    String(process.env.FC_CATCHUP_ENABLED || 'true').toLowerCase() === 'true';
const catchupDelayMs = () => Math.max(0, Number(process.env.FC_CATCHUP_DELAY_MS) || 60_000);

async function queueMissingPeriod({ now = new Date(), deps = {} } = {}) {
    const repo = deps.repository || snapshots;
    const service = deps.forest || forest;
    const period = previousCompletedPeriod(now, timezone());
    const existing = await repo.getByPeriod(period.year, period.month);
    if (existing) {
        return { queued: false, reason: 'PERIOD_ALREADY_EXISTS', period, snapshot: existing };
    }
    const run = await service.requestRun({ ...period, trigger: 'cron', requestedBy: null });
    return { queued: !run.deduplicated, period, ...run };
}

const runScheduled = async () => {
    try {
        const result = await queueMissingPeriod();
        if (result.queued) {
            console.info(
                `[FOREST] queued scheduled classification ${result.period.year}/${result.period.month}`,
            );
        }
        return result;
    } catch (error) {
        console.error(`[FOREST] scheduled classification failed: ${error.message}`);
        return { queued: false, error: error.message };
    }
};

const start = () => {
    if (!enabled()) {
        console.info('[FOREST] scheduler disabled (FC_ENABLED=false)');
        return { started: false, reason: 'DISABLED' };
    }
    if (scheduledTask) {
        return { started: false, reason: 'ALREADY_STARTED' };
    }
    const expression = cronExpression();
    if (!cron.validate(expression)) {
        console.error(`[FOREST] invalid FC_CRON: ${expression}`);
        return { started: false, reason: 'INVALID_CRON' };
    }
    scheduledTask = cron.schedule(expression, runScheduled, { timezone: timezone() });
    if (catchupEnabled()) {
        catchupTimer = setTimeout(() => {
            catchupTimer = null;
            void runScheduled();
        }, catchupDelayMs());
        catchupTimer.unref?.();
    }
    console.info(`[FOREST] scheduler started (${expression} @ ${timezone()})`);
    return { started: true };
};

const stop = () => {
    if (scheduledTask) {
        scheduledTask.stop();
        scheduledTask = null;
    }
    if (catchupTimer) {
        clearTimeout(catchupTimer);
        catchupTimer = null;
    }
};

const __resetForTests = () => stop();

module.exports = { start, stop, queueMissingPeriod, runScheduled, __resetForTests };
