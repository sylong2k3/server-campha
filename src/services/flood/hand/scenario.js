'use strict';

/**
 * M2 HAND scenario mask.
 *
 * Given a level in metres (e.g. 5 m per Flood_D:227), flag every pixel whose
 * HAND ≤ level as "would be inundated at this level". The result is a
 * SCENARIO — not an observation — so it must always be labelled `Kịch bản
 * HAND` in downstream UI (§16 terminology rule).
 *
 * @source docs/Flood_D_final.js (`runHANDScenario`:3403–3540, mask line ≈3477)
 * @rule   architecture doc §16 — never label M2 as observed flood
 */

/**
 * @param {object} ee
 * @param {object} args
 * @param {object} args.handImage    — HAND image (from common/hand.buildHandStack.hand)
 * @param {number} args.levelM       — scenario inundation level in metres
 * @param {object} [args.slopeDeg]   — optional slope image; if supplied the mask
 *                                     is additionally gated by slope ≤ maximumSlope
 * @param {number} [args.maximumSlope=12] — Flood_D:228 default
 * @returns {object} ee.Image (binary — 1 = scenario-inundated)
 */
function scenarioMask(ee, { handImage, levelM, slopeDeg = null, maximumSlope = 12 } = {}) {
    if (!ee) {
        throw new Error('hand.scenario.scenarioMask requires the ee module');
    }
    if (!handImage) {
        throw new Error('hand.scenario.scenarioMask requires a handImage');
    }
    if (!Number.isFinite(levelM) || levelM <= 0) {
        throw new Error('hand.scenario.scenarioMask requires a positive numeric levelM');
    }
    if (!Number.isFinite(maximumSlope) || maximumSlope < 0) {
        throw new Error('hand.scenario.scenarioMask requires a non-negative maximumSlope');
    }
    let mask = handImage.lte(levelM);
    if (slopeDeg) {
        mask = mask.and(slopeDeg.lte(maximumSlope));
    }
    return mask.rename('hand_scenario');
}

module.exports = { scenarioMask };
