'use strict';

/**
 * Nightly cron for the M1 (event flood) automation.
 *
 * See services/flood/event-daily.service for the tick logic. This module only
 * wires the schedule + start/stop. Disabled by default so ops opts in per
 * deployment.
 *
 * Env:
 *   FLOOD_EVENT_DAILY_ENABLED           default 'false'
 *   FLOOD_EVENT_DAILY_CRON              default '0 3 * * *' (03:00 daily)
 *   FLOOD_EVENT_DAILY_CRON_TZ           default 'Asia/Ho_Chi_Minh'
 *   FLOOD_EVENT_DAILY_LOOKBACK_DAYS     default 3
 *   FLOOD_EVENT_DAILY_PRE_START/END     default 2024-01-01 / 2024-04-30
 *   FLOOD_EVENT_DAILY_CATCHUP_ENABLED   default 'false'
 *   FLOOD_EVENT_DAILY_CATCHUP_DELAY_MS  default 120_000
 */

const cron = require('node-cron');
const eventDaily = require('../services/flood/event-daily.service');

let scheduledTask = null;
let catchupTimer = null;

const readBool = (name, fallback) => {
    const raw = process.env[name];
    if (raw === undefined || raw === null || raw === '') {
        return fallback;
    }
    return String(raw).toLowerCase() === 'true';
};
const readNumber = (name, fallback) => {
    const value = Number(process.env[name]);
    return Number.isFinite(value) && value > 0 ? value : fallback;
};

const settings = () => ({
    enabled: readBool('FLOOD_EVENT_DAILY_ENABLED', false),
    expression: process.env.FLOOD_EVENT_DAILY_CRON || '0 3 * * *',
    timezone: process.env.FLOOD_EVENT_DAILY_CRON_TZ || 'Asia/Ho_Chi_Minh',
    lookbackDays: Math.max(1, Math.min(30, readNumber('FLOOD_EVENT_DAILY_LOOKBACK_DAYS', 3))),
    preStart: process.env.FLOOD_EVENT_DAILY_PRE_START || '2024-01-01',
    preEnd: process.env.FLOOD_EVENT_DAILY_PRE_END || '2024-04-30',
    catchupEnabled: readBool('FLOOD_EVENT_DAILY_CATCHUP_ENABLED', false),
    catchupDelayMs: readNumber('FLOOD_EVENT_DAILY_CATCHUP_DELAY_MS', 120_000),
});

const runScheduled = async () => {
    const s = settings();
    try {
        return await eventDaily.runOnce({
            timezone: s.timezone,
            lookbackDays: s.lookbackDays,
            preStart: s.preStart,
            preEnd: s.preEnd,
        });
    } catch (error) {
        console.error(`[FLOOD-EVENT-DAILY] tick failed: ${error.message}`);
        return { queued: false, error: error.message };
    }
};

const start = () => {
    const s = settings();
    if (!s.enabled) {
        console.info('[FLOOD-EVENT-DAILY] scheduler disabled (FLOOD_EVENT_DAILY_ENABLED=false)');
        return { started: false, reason: 'DISABLED' };
    }
    if (scheduledTask) {
        return { started: false, reason: 'ALREADY_STARTED' };
    }
    if (!cron.validate(s.expression)) {
        console.error(`[FLOOD-EVENT-DAILY] invalid FLOOD_EVENT_DAILY_CRON: ${s.expression}`);
        return { started: false, reason: 'INVALID_CRON' };
    }
    scheduledTask = cron.schedule(s.expression, runScheduled, { timezone: s.timezone });
    if (s.catchupEnabled) {
        catchupTimer = setTimeout(() => {
            catchupTimer = null;
            void runScheduled();
        }, s.catchupDelayMs);
        catchupTimer.unref?.();
    }
    console.info(
        `[FLOOD-EVENT-DAILY] scheduler started (${s.expression} @ ${s.timezone}, lookback=${s.lookbackDays}d, baseline=${s.preStart}..${s.preEnd})`,
    );
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

module.exports = { start, stop, runScheduled, settings, __resetForTests };
