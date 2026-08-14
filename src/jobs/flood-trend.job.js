'use strict';

/**
 * Quarterly cron for the M5 flood-trend module.
 *
 * Flood analyses are event-triggered by admins (POST /admin/flood/runs), but
 * the trend module is deterministic and periodic: it computes a single
 * dry-baseline + 4-month wet-season frequency map for a full calendar year.
 * A cron makes sure the "last completed wet season" always has a fresh
 * artefact without a human clicking submit.
 *
 * Behaviour:
 *   - Disabled by default (FLOOD_TREND_ENABLED=false).
 *   - Cron default '0 2 1 1,4,7,10 *' — 02:00 local time on the 1st of every
 *     quarter (Jan/Apr/Jul/Oct). Cheap on days with nothing to publish
 *     because analysis.service dedupes by analysisKey (SHA of config).
 *   - Always targets the PREVIOUS full calendar year so the wet season has
 *     already closed (Oct 31) before we compose the frequency raster.
 *   - Mode taken from FLOOD_TREND_MODE (product|calibration). Calibration
 *     runs are archive-only per §19 (canAutoPublish gate in run-executor).
 *
 * @see docs/GEE_FLOOD_INTEGRATION_ARCHITECTURE.md §5 (M5 trend module)
 * @see services/flood/config/defaults.js TREND_DEFAULTS
 */

const cron = require('node-cron');
const floodConfig = require('../configs/flood');
const analysisService = require('../services/flood/analysis.service');
const { TREND_DEFAULTS } = require('../services/flood/config/defaults');

let scheduledTask = null;
let catchupTimer = null;

const currentYearInTimezone = (now, timezone) => {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric' })
        .formatToParts(now)
        .reduce((acc, part) => {
            if (part.type === 'year') {
                acc.year = Number(part.value);
            }
            return acc;
        }, {});
    return parts.year;
};

/**
 * Build a TREND run config for the previous calendar year.
 * Deterministic per year, so cron re-fires the same key and analysis.service
 * dedupes when a matching run is already active/complete.
 */
const buildTrendConfigForYear = (targetYear) => ({
    ...TREND_DEFAULTS,
    dryStart: `${targetYear}-01-01`,
    dryEnd: `${targetYear}-04-30`,
    periods: [
        { start: `${targetYear}-07-01`, end: `${targetYear}-07-31` },
        { start: `${targetYear}-08-01`, end: `${targetYear}-08-31` },
        { start: `${targetYear}-09-01`, end: `${targetYear}-09-30` },
        { start: `${targetYear}-10-01`, end: `${targetYear}-10-31` },
    ],
});

async function queueTrendForPreviousYear({ now = new Date(), deps = {} } = {}) {
    const service = deps.analysis || analysisService;
    const settings = floodConfig.trendCron();
    const currentYear = currentYearInTimezone(now, settings.timezone);
    const targetYear = currentYear - 1;
    const config = buildTrendConfigForYear(targetYear);
    try {
        const run = await service.submit(
            { module: 'trend', config, mode: settings.mode },
            null,
        );
        return { queued: true, targetYear, runId: run.id, status: run.status };
    } catch (error) {
        if (error?.errorCodes?.includes?.('FLOOD_RUN_ALREADY_ACTIVE')) {
            return { queued: false, reason: 'ALREADY_ACTIVE', targetYear };
        }
        throw error;
    }
}

const runScheduled = async () => {
    try {
        const result = await queueTrendForPreviousYear();
        if (result.queued) {
            console.info(
                `[FLOOD-TREND] queued trend run for ${result.targetYear} (runId=${result.runId})`,
            );
        } else {
            console.info(
                `[FLOOD-TREND] skipped ${result.targetYear} (${result.reason || 'DEDUPED'})`,
            );
        }
        return result;
    } catch (error) {
        console.error(`[FLOOD-TREND] scheduled trend run failed: ${error.message}`);
        return { queued: false, error: error.message };
    }
};

const start = () => {
    const settings = floodConfig.trendCron();
    if (!settings.enabled) {
        console.info('[FLOOD-TREND] scheduler disabled (FLOOD_TREND_ENABLED=false)');
        return { started: false, reason: 'DISABLED' };
    }
    if (scheduledTask) {
        return { started: false, reason: 'ALREADY_STARTED' };
    }
    if (!cron.validate(settings.expression)) {
        console.error(`[FLOOD-TREND] invalid FLOOD_TREND_CRON: ${settings.expression}`);
        return { started: false, reason: 'INVALID_CRON' };
    }
    scheduledTask = cron.schedule(settings.expression, runScheduled, {
        timezone: settings.timezone,
    });
    if (settings.catchupEnabled) {
        catchupTimer = setTimeout(() => {
            catchupTimer = null;
            void runScheduled();
        }, settings.catchupDelayMs);
        catchupTimer.unref?.();
    }
    console.info(
        `[FLOOD-TREND] scheduler started (${settings.expression} @ ${settings.timezone}, mode=${settings.mode})`,
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

module.exports = {
    start,
    stop,
    runScheduled,
    queueTrendForPreviousYear,
    buildTrendConfigForYear,
    __resetForTests,
};
