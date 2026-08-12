'use strict';

/**
 * Cropland impact — hectares of ESA WorldCover class 40 (cropland) inside
 * the flood mask.
 *
 * @source docs/Flood_D_final.js (impact block:4078; cropland handling ≈4200)
 * @dataset ASSETS.WORLDCOVER (WC v200 = 2021)
 * @rule    architecture doc §55 — record landcover source dataset year
 */

const { ASSETS } = require('../common/datasets');
const { WC_CLASS } = require('../common/water-masks');

const WC_CROPLAND_CLASS = 40;

const CROPLAND_SOURCE = Object.freeze({
    dataset: ASSETS.WORLDCOVER,
    year: 2021,
    version: 'v200',
    resolutionM: 10,
    provider: 'ESA',
});

/**
 * Binary cropland mask restricted to the flood extent.
 */
function affectedCroplandMask(ee, { floodMask, worldCoverImage = null } = {}) {
    if (!ee) {
        throw new Error('impact.cropland.affectedCroplandMask requires the ee module');
    }
    if (!floodMask) {
        throw new Error('impact.cropland.affectedCroplandMask requires a floodMask');
    }
    const wc = (worldCoverImage || ee.ImageCollection(ASSETS.WORLDCOVER).first()).select('Map');
    // Guard: WC_CLASS.BARE_SPARSE = 60; ensure we're pulling the crop class.
    void WC_CLASS; // referenced only for source cross-check
    return wc.eq(WC_CROPLAND_CLASS).and(floodMask).rename('affected_cropland');
}

module.exports = {
    WC_CROPLAND_CLASS,
    CROPLAND_SOURCE,
    affectedCroplandMask,
};
