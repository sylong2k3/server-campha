'use strict';

/**
 * Reducer helpers used by every M1/M2/M3/M4 result-summary step.
 *
 * Sum-of-pixel-area over a mask is easy to get wrong when the mask is empty
 * (reducer returns null → NaN) or when the projection has been implicitly
 * changed by an upstream operation. These wrappers set the canonical scale +
 * CRS + tileScale + maxPixels every time so callers can't drift.
 *
 * Every helper is thin — the flood pipeline lives above; this module
 * DELIBERATELY holds no run state.
 *
 * @source docs/Flood_D_final.js (calculateAreaHaSafe:4001, reportArea:4016)
 */

const {
    ANALYSIS_CRS,
    ANALYSIS_SCALE_M,
    DIAGNOSTIC_TILE_SCALE,
    REDUCE_MAX_PIXELS,
} = require('./projection');

const PIXEL_AREA_M2_PER_HA = 10000;

/**
 * Safe area-in-hectares reduce. Returns an ee.Number that is 0 when the
 * mask covers no pixels (rather than null, which crashes the downstream JS).
 *
 * @param {object} ee
 * @param {object} args
 * @param {object} args.maskImage — binary ee.Image (1 = keep)
 * @param {object} args.geometry  — ee.Geometry to reduce over
 * @param {number} [args.scale=ANALYSIS_SCALE_M]
 * @param {string} [args.crs=ANALYSIS_CRS]
 * @param {number} [args.maxPixels=REDUCE_MAX_PIXELS]
 * @param {number} [args.tileScale=DIAGNOSTIC_TILE_SCALE]
 * @returns {object} ee.Number (hectares)
 */
function areaHaSafe(
    ee,
    {
        maskImage,
        geometry,
        scale = ANALYSIS_SCALE_M,
        crs = ANALYSIS_CRS,
        maxPixels = REDUCE_MAX_PIXELS,
        tileScale = DIAGNOSTIC_TILE_SCALE,
    } = {},
) {
    if (!ee) {
        throw new Error('reducers.areaHaSafe requires the ee module');
    }
    if (!maskImage) {
        throw new Error('reducers.areaHaSafe requires a maskImage');
    }
    if (!geometry) {
        throw new Error('reducers.areaHaSafe requires a geometry');
    }

    const pixelArea = ee.Image.pixelArea().updateMask(maskImage);
    const stats = pixelArea.reduceRegion({
        reducer: ee.Reducer.sum(),
        geometry,
        scale,
        crs,
        maxPixels,
        tileScale,
        bestEffort: true,
    });
    const raw = ee.Number(stats.get('area'));
    // null → 0, then convert m² to ha.
    return ee.Number(ee.Algorithms.If(raw, raw, 0)).divide(PIXEL_AREA_M2_PER_HA);
}

/**
 * Percentile reduce that returns a JS-friendly dictionary { p<X>: value }.
 * Used by diagnostics/percentiles.js in calibration mode.
 */
function percentiles(
    ee,
    {
        image,
        geometry,
        percentileList = [1, 25, 50, 75, 99],
        scale = ANALYSIS_SCALE_M,
        crs = ANALYSIS_CRS,
        tileScale = DIAGNOSTIC_TILE_SCALE,
        maxPixels = REDUCE_MAX_PIXELS,
    } = {},
) {
    if (!ee) {
        throw new Error('reducers.percentiles requires the ee module');
    }
    if (!image) {
        throw new Error('reducers.percentiles requires an image');
    }
    if (!geometry) {
        throw new Error('reducers.percentiles requires a geometry');
    }

    return image.reduceRegion({
        reducer: ee.Reducer.percentile(percentileList),
        geometry,
        scale,
        crs,
        maxPixels,
        tileScale,
        bestEffort: true,
    });
}

/**
 * Count-per-class reduce. Useful for the M4 land-cover impact chart
 * (Flood_D:4282). Returns an ee.Dictionary keyed by class integer.
 */
function areaHaByClass(
    ee,
    {
        classifiedImage,
        maskImage,
        geometry,
        scale = ANALYSIS_SCALE_M,
        crs = ANALYSIS_CRS,
        tileScale = DIAGNOSTIC_TILE_SCALE,
        maxPixels = REDUCE_MAX_PIXELS,
    } = {},
) {
    if (!ee) {
        throw new Error('reducers.areaHaByClass requires the ee module');
    }
    if (!classifiedImage) {
        throw new Error('reducers.areaHaByClass requires a classifiedImage');
    }
    if (!maskImage) {
        throw new Error('reducers.areaHaByClass requires a maskImage');
    }
    if (!geometry) {
        throw new Error('reducers.areaHaByClass requires a geometry');
    }

    const area = ee.Image.pixelArea().updateMask(maskImage).divide(PIXEL_AREA_M2_PER_HA);
    return area.addBands(classifiedImage.rename('class')).reduceRegion({
        reducer: ee.Reducer.sum().group({ groupField: 1, groupName: 'class' }),
        geometry,
        scale,
        crs,
        maxPixels,
        tileScale,
        bestEffort: true,
    });
}

module.exports = {
    PIXEL_AREA_M2_PER_HA,
    areaHaSafe,
    percentiles,
    areaHaByClass,
};
