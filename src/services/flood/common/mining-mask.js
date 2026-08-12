'use strict';

/**
 * Mining false-positive mask.
 *
 * Cẩm Phả is a coal-mining town; open-pit mines and their waste dumps
 * produce SAR backscatter patterns that superficially resemble open water
 * (dark, low VH). This mask flags candidate mining pixels so the M1 flood
 * classifier can suppress or QA them.
 *
 * Two data paths:
 *   1. HEURISTIC — WorldCover bare-ground (class 60) intersected with terrain
 *      indicators (steep slope OR high HAND OR high elevation) that never
 *      hold real flooding. Always available; runs stamp
 *      `mining_source: 'PROXY_WC_BARE'` in metadata.
 *   2. AUTHORITATIVE — an admin-supplied ee.FeatureCollection polygon asset
 *      (config: `MINING_POLYGON_ASSET_ID`). When supplied, the heuristic is
 *      OR-ed with the polygon → both signals win. Runs stamp
 *      `mining_source: 'ASSET'`.
 *
 * @source docs/Flood_D_final.js (line 1963, `createMiningFalsePositiveMask`)
 * @dataset ASSETS.WORLDCOVER
 * @rule §81 mining_candidate is QA-only, never confirmed flood
 */

const { ASSETS } = require('./datasets');
const { WC_CLASS } = require('./water-masks');
const { MINING_POLYGON_ASSET_ID } = require('../config/defaults');

/** Terrain indicators that make a bare-ground pixel a mining candidate (Flood_D:1963–1998). */
const MINING_HEURISTIC = Object.freeze({
    slopeGtDeg: 3,
    handGtM: 8,
    elevGtM: 80,
});

const MINING_SOURCE = Object.freeze({
    PROXY_WC_BARE: 'PROXY_WC_BARE',
    ASSET: 'ASSET',
});

/**
 * Build the mining false-positive mask.
 *
 * @param {object} ee
 * @param {object} args
 * @param {object} args.slopeDeg          — slope image (degrees)
 * @param {object} args.handImage         — HAND image (metres)
 * @param {object} args.elevationImage    — DTM elevation (metres)
 * @param {object} [args.worldCoverImage] — pre-loaded WC image (optional)
 * @param {string} [args.miningAssetId]   — override for the config default
 * @returns {{ mask: object, source: string, usedAsset: boolean }}
 */
function createMiningMask(
    ee,
    {
        slopeDeg,
        handImage,
        elevationImage,
        worldCoverImage = null,
        miningAssetId = MINING_POLYGON_ASSET_ID,
    } = {},
) {
    if (!ee) {throw new Error('mining-mask.createMiningMask requires the ee module');}
    if (!slopeDeg || !handImage || !elevationImage) {
        throw new Error(
            'mining-mask.createMiningMask requires slopeDeg + handImage + elevationImage',
        );
    }

    // ── Heuristic branch ─────────────────────────────────────────────────
    const wc = (worldCoverImage || ee.ImageCollection(ASSETS.WORLDCOVER).first()).select('Map');
    const isBare = wc.eq(WC_CLASS.BARE_SPARSE);
    const terrainCandidate = slopeDeg
        .gt(MINING_HEURISTIC.slopeGtDeg)
        .or(handImage.gt(MINING_HEURISTIC.handGtM))
        .or(elevationImage.gt(MINING_HEURISTIC.elevGtM));
    let mask = isBare.and(terrainCandidate).rename('mining_candidate');
    let source = MINING_SOURCE.PROXY_WC_BARE;
    let usedAsset = false;

    // ── Optional authoritative asset ────────────────────────────────────
    if (miningAssetId && typeof miningAssetId === 'string' && miningAssetId.trim().length > 0) {
        const polygonFc = ee.FeatureCollection(miningAssetId);
        const polygonMask = polygonFc.reduceToImage(['constant'], ee.Reducer.first()).gt(0);
        mask = mask.or(polygonMask).rename('mining_candidate');
        source = MINING_SOURCE.ASSET;
        usedAsset = true;
    }

    return { mask, source, usedAsset };
}

module.exports = {
    MINING_HEURISTIC,
    MINING_SOURCE,
    createMiningMask,
};
