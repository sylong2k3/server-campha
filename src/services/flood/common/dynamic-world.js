'use strict';

/**
 * Google Dynamic World v1 composite loader.
 *
 * The `label` band is a categorical class (0..8). We take the annual mode to
 * suppress speckle. Reference project cached this at module level — for the
 * flood domain we return a per-run cache object instead (§18 no global
 * mutable state).
 *
 * Dynamic World class IDs (Google spec):
 *   0 water   1 trees   2 grass   3 flooded_vegetation   4 crops
 *   5 shrub_and_scrub   6 built   7 bare   8 snow_and_ice
 *
 * @source docs/Flood_D_final.js (lines 794–974)
 * @dataset ASSETS.DYNAMIC_WORLD
 */

const { ASSETS } = require('./datasets');

const DW_CLASS = Object.freeze({
    WATER: 0,
    TREES: 1,
    GRASS: 2,
    FLOODED_VEGETATION: 3,
    CROPS: 4,
    SHRUB_AND_SCRUB: 5,
    BUILT: 6,
    BARE: 7,
    SNOW_AND_ICE: 8,
});

/** Focal-mean radius for smoothing built density (Flood_D:2079). */
const BUILT_DENSITY_RADIUS_M = 30;

/**
 * Produce a mode composite over [startDate, endDate] restricted to `aoi`.
 * Returns an ee.Image with a single `label` band (byte).
 */
function composite(ee, { startDate, endDate, aoi } = {}) {
    if (!ee) {throw new Error('dynamic-world.composite requires the ee module');}
    if (!startDate || !endDate) {
        throw new Error('dynamic-world.composite requires startDate + endDate');
    }
    if (!aoi) {throw new Error('dynamic-world.composite requires an aoi geometry');}
    return ee
        .ImageCollection(ASSETS.DYNAMIC_WORLD)
        .filterBounds(aoi)
        .filterDate(startDate, endDate)
        .select('label')
        .mode();
}

/**
 * Boolean per-class mask helper.
 */
function classMask(labelImage, classId, name) {
    if (!labelImage) {throw new Error('dynamic-world.classMask requires labelImage');}
    return labelImage.eq(classId).rename(name || `dw_class_${classId}`);
}

/**
 * Return a stack of the four masks flood pipelines routinely consume:
 * water, built, flooded_vegetation, bare — plus a smoothed builtDensity band
 * for the M1 urban-double-bounce branch.
 *
 * @param {object} ee
 * @param {object} args
 * @param {string} args.startDate
 * @param {string} args.endDate
 * @param {object} args.aoi
 * @param {number} [args.builtDensityRadiusM=30]
 * @returns {object} { label, water, built, floodedVeg, bare, builtDensity, cacheKey }
 */
function buildContext(ee, args = {}) {
    const { builtDensityRadiusM = BUILT_DENSITY_RADIUS_M, startDate, endDate, aoi } = args;
    const label = composite(ee, { startDate, endDate, aoi });
    const water = classMask(label, DW_CLASS.WATER, 'dw_water');
    const built = classMask(label, DW_CLASS.BUILT, 'dw_built');
    const floodedVeg = classMask(label, DW_CLASS.FLOODED_VEGETATION, 'dw_flooded_veg');
    const bare = classMask(label, DW_CLASS.BARE, 'dw_bare');
    // Focal mean gives a 0..1 density that the M1 urban branch checks
    // against `urbanBuiltDensity=0.5` (Flood_D:221).
    const builtDensity = built
        .focal_mean(builtDensityRadiusM, 'circle', 'meters')
        .rename('dw_built_density');
    return {
        label,
        water,
        built,
        floodedVeg,
        bare,
        builtDensity,
        cacheKey: `${startDate}|${endDate}`,
    };
}

/**
 * Per-run cache factory (replaces the reference project's module-level
 * BUILT_MASK_CACHE — §18 no global mutable state rule). The caller passes a
 * factory value to every downstream helper so isolated runs don't share
 * state.
 *
 * Usage:
 *   const cache = dynamicWorld.createRunCache();
 *   const ctx = cache.get(ee, {startDate, endDate, aoi});
 *   const built = cache.get(...).built;
 */
function createRunCache() {
    const cache = new Map();
    return {
        get(ee, args) {
            const key = `${args.startDate}|${args.endDate}`;
            if (!cache.has(key)) {cache.set(key, buildContext(ee, args));}
            return cache.get(key);
        },
        clear() {
            cache.clear();
        },
        size: () => cache.size,
    };
}

module.exports = {
    DW_CLASS,
    BUILT_DENSITY_RADIUS_M,
    composite,
    classMask,
    buildContext,
    createRunCache,
};
