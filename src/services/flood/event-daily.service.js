'use strict';

/**
 * Daily automation for the M1 event flood pipeline.
 *
 * Cron fires nightly. Each tick:
 *   1. Compute yesterday-back-N-days window (post-event candidate).
 *   2. Ask Earth Engine how many Sentinel-1 scenes cover Cẩm Phả in that
 *      window.
 *   3. If ≥1 scene → build a validated event RUN_CONFIG using the operator's
 *      configured dry-season baseline and submit through analysis.service.
 *      Dedup by analysisKey means re-firing the same window is a no-op.
 *   4. If 0 scenes → log a "skipped: no scene" audit line so ops can tell
 *      "cron didn't fire" from "cron fired but there was nothing to process".
 *
 * The daily automation is IN ADDITION to on-demand admin submits — a user
 * can still open the flood UI and submit any window they want.
 */

const { ee } = require('../../configs/gge');
const geeAdapter = require('../gee-earth-engine.adapter');
const geometry = require('./common/geometry');
const sentinel1 = require('./common/sentinel1');
const analysisService = require('./analysis.service');
const floodDebug = require('./debug.util');

const iso = (date) => date.toISOString().slice(0, 10);

/**
 * Build the analysis window for today's tick.
 *   postEnd   = today (local timezone) — inclusive
 *   postStart = today - (lookbackDays - 1)
 * A 3-day default gives the pipeline enough room to catch the most recent S1
 * pass no matter which orbit revisited Cẩm Phả overnight.
 */
function computeWindow({ now = new Date(), timezone, lookbackDays } = {}) {
    // Convert `now` to the target-timezone local Y-M-D via en-CA formatter
    // (yields "YYYY-MM-DD" reliably).
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).formatToParts(now);
    const map = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
    const endMs = Date.UTC(Number(map.year), Number(map.month) - 1, Number(map.day));
    const endDate = new Date(endMs);
    const startDate = new Date(endMs - (lookbackDays - 1) * 24 * 3_600_000);
    return { postStart: iso(startDate), postEnd: iso(endDate) };
}

/**
 * Ask GEE how many Sentinel-1 IW dual-pol scenes cover the AOI in the window.
 * A tight `evaluate()` on a `size()` call — no image reduction, no export.
 */
async function countSentinel1Scenes({ postStart, postEnd }) {
    await geeAdapter.ensureInitialized();
    const { geometry: aoi } = geometry.loadAoi(ee);
    const collection = sentinel1.getS1Collection(ee, {
        start: postStart,
        end: postEnd,
        aoi,
        pass: 'AUTO',
    });
    const count = await geeAdapter.evaluate(collection.size());
    return Number(count) || 0;
}

/**
 * One tick of the daily automation. Returns a structured result the cron
 * job logs.
 */
async function runOnce({
    now = new Date(),
    timezone,
    lookbackDays,
    preStart,
    preEnd,
    submitFn = analysisService.submit,
} = {}) {
    if (!timezone) {
        throw new Error('event-daily.runOnce requires timezone');
    }
    if (!lookbackDays || lookbackDays < 1) {
        throw new Error('event-daily.runOnce requires lookbackDays >= 1');
    }
    if (!preStart || !preEnd) {
        throw new Error('event-daily.runOnce requires preStart + preEnd');
    }
    const window = computeWindow({ now, timezone, lookbackDays });
    floodDebug.log('event-daily.tick', { ...window, lookbackDays });
    let sceneCount;
    try {
        sceneCount = await countSentinel1Scenes(window);
    } catch (error) {
        floodDebug.logError('event-daily.countSentinel1Scenes failed', error, window);
        return { queued: false, reason: 'S1_QUERY_FAILED', ...window, error: error.message };
    }
    floodDebug.log('event-daily.sceneCount', { ...window, sceneCount });
    if (sceneCount === 0) {
        console.info(
            `[FLOOD-EVENT-DAILY] no Sentinel-1 scene in ${window.postStart}..${window.postEnd}, skip`,
        );
        return { queued: false, reason: 'NO_S1_SCENE', ...window, sceneCount };
    }
    try {
        const run = await submitFn(
            {
                module: 'event',
                mode: 'product',
                config: {
                    preStart,
                    preEnd,
                    postStart: window.postStart,
                    postEnd: window.postEnd,
                    runImpactAfterM1: true,
                },
            },
            null, // system-owned run
        );
        console.info(
            `[FLOOD-EVENT-DAILY] queued event run #${run.id} for ${window.postStart}..${window.postEnd}`,
        );
        return { queued: true, runId: run.id, sceneCount, ...window };
    } catch (error) {
        if (error?.errorCodes?.includes?.('FLOOD_RUN_ALREADY_ACTIVE')) {
            floodDebug.log('event-daily.deduplicated', window);
            return { queued: false, reason: 'ALREADY_ACTIVE', sceneCount, ...window };
        }
        floodDebug.logError('event-daily.submit failed', error, window);
        return {
            queued: false,
            reason: 'SUBMIT_FAILED',
            sceneCount,
            ...window,
            error: error.message,
        };
    }
}

module.exports = {
    computeWindow,
    countSentinel1Scenes,
    runOnce,
};
