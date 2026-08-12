'use strict';

/**
 * Rainfall accumulators for M3.
 *
 *  - IMERG (NASA GPM V07): event-window totals + max instantaneous intensity.
 *    Native cadence is 30 min at mm/hr — the ×0.5 factor at Flood_D:1138
 *    converts to per-scene mm without double-scaling.
 *  - CHIRPS (UCSB Daily RNL v3): antecedent (7-day / 30-day) totals. Empty
 *    windows return a fully-masked image (not zero) so downstream logic can
 *    tell "no data" from "no rain" (Flood_D:2214–2220 caveat).
 *
 * Every helper takes `ee` as its first arg (DI, import-safe).
 *
 * @source docs/Flood_D_final.js (accumulateIMERG:1127, maxIntensity:1159, accumulateCHIRPS:1204)
 * @dataset ASSETS.IMERG_V07, ASSETS.CHIRPS_DAILY_RNL
 * @rule    architecture doc §16 — this is RAINFALL, not risk (risk is in risk-model.js)
 */

const { ASSETS } = require('../common/datasets');

/** IMERG scene-to-mm factor: native mm/hr × 0.5 h per scene = mm. */
const IMERG_MM_PER_SCENE_FACTOR = 0.5;

function _requireDates(fnName, startDate, endDate) {
    if (!startDate || !endDate) {
        throw new Error(`rain.rainfall-source.${fnName} requires startDate + endDate`);
    }
}

/**
 * Total accumulated IMERG precipitation (mm) over the window.
 */
function accumulateIMERG(ee, { startDate, endDate, aoi } = {}) {
    if (!ee) {
        throw new Error('rain.rainfall-source.accumulateIMERG requires the ee module');
    }
    _requireDates('accumulateIMERG', startDate, endDate);
    if (!aoi) {
        throw new Error('rain.rainfall-source.accumulateIMERG requires aoi');
    }
    return ee
        .ImageCollection(ASSETS.IMERG_V07)
        .filterBounds(aoi)
        .filterDate(startDate, endDate)
        .select('precipitationCal')
        .sum()
        .multiply(IMERG_MM_PER_SCENE_FACTOR)
        .rename('imerg_total_mm');
}

/**
 * Max instantaneous IMERG intensity (mm/hr) — captures storm peaks that
 * summing over the window would smooth away.
 */
function maximumIMERGIntensity(ee, { startDate, endDate, aoi } = {}) {
    if (!ee) {
        throw new Error('rain.rainfall-source.maximumIMERGIntensity requires the ee module');
    }
    _requireDates('maximumIMERGIntensity', startDate, endDate);
    if (!aoi) {
        throw new Error('rain.rainfall-source.maximumIMERGIntensity requires aoi');
    }
    return ee
        .ImageCollection(ASSETS.IMERG_V07)
        .filterBounds(aoi)
        .filterDate(startDate, endDate)
        .select('precipitationCal')
        .max()
        .rename('imerg_max_intensity_mm_per_hr');
}

/**
 * Total accumulated CHIRPS Daily RNL v3 (mm) over the window. Preserves
 * masked "no data" semantics — do NOT `.unmask(0)`.
 */
function accumulateCHIRPS(ee, { startDate, endDate, aoi } = {}) {
    if (!ee) {
        throw new Error('rain.rainfall-source.accumulateCHIRPS requires the ee module');
    }
    _requireDates('accumulateCHIRPS', startDate, endDate);
    if (!aoi) {
        throw new Error('rain.rainfall-source.accumulateCHIRPS requires aoi');
    }
    return ee
        .ImageCollection(ASSETS.CHIRPS_DAILY_RNL)
        .filterBounds(aoi)
        .filterDate(startDate, endDate)
        .select('precipitation')
        .sum()
        .rename('chirps_total_mm');
}

/**
 * Build the standard M3 rainfall bundle for a given event time. Includes
 * event-window IMERG at 3 / 6 / 24 / 72 hour lookbacks, IMERG max intensity,
 * and CHIRPS 7-day / 30-day antecedent totals. The result is the input to
 * risk-model.combineFactors.
 *
 * @param {object} ee
 * @param {object} args
 * @param {Date|string} args.eventTime         — anchor timestamp (JS Date or ISO string)
 * @param {object} args.aoi
 */
function buildRainfallStack(ee, { eventTime, aoi } = {}) {
    if (!ee) {
        throw new Error('rain.rainfall-source.buildRainfallStack requires the ee module');
    }
    if (!eventTime) {
        throw new Error('rain.rainfall-source.buildRainfallStack requires eventTime');
    }
    if (!aoi) {
        throw new Error('rain.rainfall-source.buildRainfallStack requires aoi');
    }
    // Normalise `eventTime` to a JS Date. Callers may pass an ISO string.
    const anchor = eventTime instanceof Date ? eventTime : new Date(eventTime);
    if (Number.isNaN(anchor.valueOf())) {
        throw new Error('rain.rainfall-source.buildRainfallStack got an invalid eventTime');
    }
    const iso = (d) => d.toISOString();
    const back = (hours) => new Date(anchor.getTime() - hours * 3_600_000);
    return {
        rain3h: accumulateIMERG(ee, {
            startDate: iso(back(3)),
            endDate: iso(anchor),
            aoi,
        }),
        rain6h: accumulateIMERG(ee, {
            startDate: iso(back(6)),
            endDate: iso(anchor),
            aoi,
        }),
        rain24h: accumulateIMERG(ee, {
            startDate: iso(back(24)),
            endDate: iso(anchor),
            aoi,
        }),
        rain72h: accumulateIMERG(ee, {
            startDate: iso(back(72)),
            endDate: iso(anchor),
            aoi,
        }),
        maxIntensity: maximumIMERGIntensity(ee, {
            startDate: iso(back(24)),
            endDate: iso(anchor),
            aoi,
        }),
        // Antecedent (soil-saturation proxy) — CHIRPS daily.
        rain7d: accumulateCHIRPS(ee, {
            startDate: iso(back(24 * 7)),
            endDate: iso(anchor),
            aoi,
        }),
        rain30d: accumulateCHIRPS(ee, {
            startDate: iso(back(24 * 30)),
            endDate: iso(anchor),
            aoi,
        }),
    };
}

/**
 * MANUAL rainfall fallback — the admin supplies numeric amounts. Wraps the
 * numbers in ee.Image so the downstream risk-model treats them uniformly.
 */
function buildManualRainfallStack(ee, rainfall = {}) {
    if (!ee) {
        throw new Error('rain.rainfall-source.buildManualRainfallStack requires the ee module');
    }
    const asImg = (v) => (Number.isFinite(v) ? ee.Image(v) : null);
    return {
        rain3h: asImg(rainfall.amount3h),
        rain6h: asImg(rainfall.amount6h),
        rain24h: asImg(rainfall.amount24h),
        rain72h: asImg(rainfall.amount72h),
        rain7d: asImg(rainfall.amount7d),
        rain30d: asImg(rainfall.amount30d),
        maxIntensity: null,
    };
}

module.exports = {
    IMERG_MM_PER_SCENE_FACTOR,
    accumulateIMERG,
    maximumIMERGIntensity,
    accumulateCHIRPS,
    buildRainfallStack,
    buildManualRainfallStack,
};
