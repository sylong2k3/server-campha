'use strict';

/**
 * Tidal split — separate the raw flood mask into `floodNonTidal` (the
 * publication-eligible MAIN product) and `tidalFloodCandidate` (QA-only per
 * §80).
 *
 * The reference project (Flood_D:2923–2931) flags but does NOT DELETE tidal
 * pixels. This module preserves that: BOTH outputs are returned so admin
 * dashboards can show tidal-uncertainty overlays without polluting reportable
 * totals.
 *
 * @source docs/Flood_D_final.js (lines 2923–2931)
 * @rule   architecture doc §80 — tidal_candidate is proxy-only, never confirmed
 */

/**
 * Split the flood mask by tidal uncertainty.
 *
 * @param {object} ee
 * @param {object} args
 * @param {object} args.floodMask          — binary ee.Image (raw flood)
 * @param {object} args.tidalUncertainty   — binary ee.Image (from common/water-masks.tidalUncertainty)
 * @returns {{ floodNonTidal: object, tidalFloodCandidate: object }}
 */
function splitByTidal(ee, { floodMask, tidalUncertainty } = {}) {
    if (!ee) {throw new Error('event.tidal-split.splitByTidal requires the ee module');}
    if (!floodMask) {throw new Error('event.tidal-split.splitByTidal requires a floodMask');}
    if (!tidalUncertainty) {
        throw new Error('event.tidal-split.splitByTidal requires tidalUncertainty');
    }
    const nonTidal = floodMask.and(tidalUncertainty.not()).rename('flood_non_tidal');
    const tidal = floodMask.and(tidalUncertainty).rename('tidal_flood_candidate');
    return { floodNonTidal: nonTidal, tidalFloodCandidate: tidal };
}

/**
 * Confidence penalty applied to tidal pixels (Flood_D:2796–2801) — 0.5 factor.
 * Exposed so orchestrator can stamp a per-pixel confidence image.
 */
const TIDAL_CONFIDENCE_FACTOR = 0.5;

module.exports = { splitByTidal, TIDAL_CONFIDENCE_FACTOR };
