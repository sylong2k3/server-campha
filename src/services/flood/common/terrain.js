'use strict';

/**
 * Terrain helpers: DTM/DSM + slope + aspect.
 *
 * FABDEM is the primary DTM (bare-earth). If FABDEM is unavailable the loader
 * falls back to Copernicus DEM GLO-30 (DSM) and stamps a warning on the run —
 * DSM slope on urban / vegetated pixels differs materially from DTM slope
 * (Flood_D:82 log shows +210 ha excluded-terrain when raised 5→15°).
 *
 * Every function takes `ee` as its first argument (import-safe, testable).
 *
 * @source docs/Flood_D_final.js (lines 577–756)
 * @dataset ASSETS.FABDEM, ASSETS.COPERNICUS_DEM_GLO30
 * @rule    architecture doc §15 (thresholds locked); FABDEM commercial gate
 *          documented in FLOOD_DATA_PROVENANCE.md §8
 */

const { ASSETS, NON_COMMERCIAL } = require('./datasets');

const TERRAIN_SOURCE = Object.freeze({
    FABDEM: 'FABDEM',
    COPERNICUS_DSM: 'COPERNICUS_DSM',
});

/**
 * Load the DTM elevation image. Tries FABDEM first; on any error (rename,
 * quota, permission) the loader may be reinvoked with `useFallback: true`.
 * Does NOT swallow errors silently — callers must call again explicitly.
 *
 * @param {object} ee
 * @param {object} [opts]
 * @param {boolean} [opts.useFallback=false] — read the Copernicus DSM instead
 * @returns {{ image: object, source: 'FABDEM'|'COPERNICUS_DSM',
 *            isFallback: boolean, nonCommercial: boolean }}
 */
function loadDtm(ee, { useFallback = false } = {}) {
    if (!ee) {throw new Error('terrain.loadDtm requires the ee module');}
    if (useFallback) {
        const image = ee.ImageCollection(ASSETS.COPERNICUS_DEM_GLO30).select('DEM').mosaic();
        return {
            image,
            source: TERRAIN_SOURCE.COPERNICUS_DSM,
            isFallback: true,
            nonCommercial: false,
        };
    }
    const image = ee.ImageCollection(ASSETS.FABDEM).select('b1').mosaic();
    return {
        image,
        source: TERRAIN_SOURCE.FABDEM,
        isFallback: false,
        nonCommercial: NON_COMMERCIAL.has(ASSETS.FABDEM),
    };
}

/**
 * Compute slope (degrees) from a DTM image. Uses `ee.Terrain.slope`.
 */
function slopeDegrees(ee, dtmImage) {
    if (!ee) {throw new Error('terrain.slopeDegrees requires the ee module');}
    if (!dtmImage) {throw new Error('terrain.slopeDegrees requires a DTM image');}
    return ee.Terrain.slope(dtmImage);
}

/**
 * Compute aspect (degrees). Reference splits into sin/cos because linear
 * aspect wraps at 360°.
 */
function aspectComponents(ee, dtmImage) {
    if (!ee) {throw new Error('terrain.aspectComponents requires the ee module');}
    if (!dtmImage) {throw new Error('terrain.aspectComponents requires a DTM image');}
    const aspect = ee.Terrain.aspect(dtmImage);
    const asRad = aspect.multiply(Math.PI / 180);
    return {
        aspect,
        aspectSin: asRad.sin().rename('aspect_sin'),
        aspectCos: asRad.cos().rename('aspect_cos'),
    };
}

/**
 * Convenience bundle used by M1/M5 pipelines. Returns everything derived from
 * a single DTM read: elevation, slope, aspect (+ sin/cos).
 */
function buildTerrainStack(ee, opts = {}) {
    const { image: elevation, source, isFallback, nonCommercial } = loadDtm(ee, opts);
    const slope = slopeDegrees(ee, elevation);
    const { aspect, aspectSin, aspectCos } = aspectComponents(ee, elevation);
    return {
        elevation,
        slope,
        aspect,
        aspectSin,
        aspectCos,
        source,
        isFallback,
        nonCommercial,
    };
}

module.exports = {
    TERRAIN_SOURCE,
    loadDtm,
    slopeDegrees,
    aspectComponents,
    buildTerrainStack,
};
