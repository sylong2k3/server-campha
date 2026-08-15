'use strict';

/**
 * M2 HAND depth image.
 *
 * `depth = level − HAND`, floored at 0 and clipped to the scenario mask so
 * downstream reducers ignore non-inundated pixels.
 *
 * @source docs/Flood_D_final.js (`runHANDScenario` depth line ≈3477)
 */

/**
 * @param {object} ee
 * @param {object} args
 * @param {object} args.handImage    — HAND image (from common/hand.buildHandStack.hand)
 * @param {number} args.levelM
 * @param {object} args.scenarioMask — binary mask from scenario.scenarioMask
 * @returns {object} ee.Image (depth in metres, only where mask == 1)
 */
function depthImage(ee, { handImage, levelM, scenarioMask } = {}) {
    if (!ee) {
        throw new Error('hand.depth.depthImage requires the ee module');
    }
    if (!handImage) {
        throw new Error('hand.depth.depthImage requires a handImage');
    }
    if (!scenarioMask) {
        throw new Error('hand.depth.depthImage requires a scenarioMask');
    }
    if (!Number.isFinite(levelM) || levelM <= 0) {
        throw new Error('hand.depth.depthImage requires a positive numeric levelM');
    }
    const raw = ee.Image(levelM).subtract(handImage);
    return raw.max(0).updateMask(scenarioMask).rename('hand_depth');
}

module.exports = { depthImage };
