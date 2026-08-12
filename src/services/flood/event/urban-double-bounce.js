'use strict';

/**
 * Urban double-bounce branch (Flood_D:2197–2242).
 *
 * SAR "double-bounce" is where signal reflects off a horizontal water surface
 * onto a vertical building wall (or vice-versa), producing an anomalous
 * BRIGHTENING in VV. In flooded urban areas this can be a useful positive
 * indicator — but it also fires on dry seasonal drift of urban co-pol, so
 * historical FP rate ≈ 89% on slopes.
 *
 * The reference project ships this branch DISABLED
 * (`enableUrbanDoubleBounce=false`, Flood_D:217). This module still exposes
 * the predicate for admins who explicitly opt in during calibration.
 *
 * @source docs/Flood_D_final.js (lines 2197–2242)
 * @rule   architecture doc §15 — do NOT flip enableUrbanDoubleBounce=true
 *         without §15 evidence (OLD / NEW / REASON / EVIDENCE / EXPECTED IMPACT /
 *         VALIDATION REQUIRED).
 */

/**
 * Urban double-bounce vote — all gates must fire.
 *
 *   1. VV increase ≥ `urbanVVIncreaseDb`         (Flood_D:218 = 1.5 dB)
 *   2. VV Z-score ≥ `urbanVVZ`                    (Flood_D:219 = 2.0)
 *   3. VH decrease ≤ `urbanVHDecreaseToleranceDb` (Flood_D:220 = 1.0 dB tolerance)
 *   4. Built density ≥ `urbanBuiltDensity`        (Flood_D:221 = 0.50)
 *   5. slope ≤ `urbanMaximumSlope`                (Flood_D:222 = 10°)
 *   6. HAND ≤ `urbanMaximumHAND`                  (Flood_D:223 = 15 m)
 *
 * @param {object} ee
 * @param {object} args
 * @param {object} args.vvIncrease             — post - pre VV (dB, positive = brighter)
 * @param {object} args.vvZ                    — VV Z-score against baseline scale
 * @param {object} args.vhDecrease             — pre - post VH (dB, positive = darker)
 * @param {object} args.builtDensity           — 0..1 focal-mean of DW built (common/dynamic-world)
 * @param {object} args.slopeDeg
 * @param {object} args.handImage
 * @param {object} args.thresholds             — see the 6 numeric knobs above
 * @returns {object} ee.Image (binary vote)
 */
function urbanDoubleBounceVote(
    ee,
    { vvIncrease, vvZ, vhDecrease, builtDensity, slopeDeg, handImage, thresholds } = {},
) {
    if (!ee) {
        throw new Error('event.urban-double-bounce.urbanDoubleBounceVote requires the ee module');
    }
    for (const [name, val] of Object.entries({
        vvIncrease,
        vvZ,
        vhDecrease,
        builtDensity,
        slopeDeg,
        handImage,
    })) {
        if (!val) {
            throw new Error(`event.urban-double-bounce.urbanDoubleBounceVote requires ${name}`);
        }
    }
    const t = thresholds || {};
    for (const key of [
        'urbanVVIncreaseDb',
        'urbanVVZ',
        'urbanVHDecreaseToleranceDb',
        'urbanBuiltDensity',
        'urbanMaximumSlope',
        'urbanMaximumHAND',
    ]) {
        if (!Number.isFinite(t[key])) {
            throw new Error(
                `event.urban-double-bounce.urbanDoubleBounceVote requires numeric thresholds.${key}`,
            );
        }
    }
    return (
        vvIncrease
            .gte(t.urbanVVIncreaseDb)
            .and(vvZ.gte(t.urbanVVZ))
            // VH decrease tolerance: allow up to N dB darkening (true urban DB
            // shouldn't show major VH change; large VH drops → this is water).
            .and(vhDecrease.lte(t.urbanVHDecreaseToleranceDb))
            .and(builtDensity.gte(t.urbanBuiltDensity))
            .and(slopeDeg.lte(t.urbanMaximumSlope))
            .and(handImage.lte(t.urbanMaximumHAND))
            .rename('urban_double_bounce_vote')
    );
}

module.exports = { urbanDoubleBounceVote };
