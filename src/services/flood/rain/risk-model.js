'use strict';

/**
 * Rain-based flood **Risk Index** (0..1).
 *
 * NOT a calibrated probability. The output is a normalised score built from
 * weighted 0..1 factors. Downstream callers MUST label this "Risk Index" /
 * "Nguy cơ theo mưa" per §16. The `PROBABILITY_CALIBRATED = false` flag on
 * `RAIN_RISK_DEFAULTS` (config/defaults.js) guards this contract.
 *
 * Weight vector (Flood_D:3541–3999):
 *   - rain (24-hour normalised)  0.28
 *   - HAND (inverse)             0.28
 *   - TWI                        0.17
 *   - slope (inverse)            0.10
 *   - hydrological distance      0.10
 *   - built (inverse)            0.07
 *
 * `unitScale(image, min, max)` returns a 0..1 value where `min` maps to 0 and
 * `max` maps to 1 (with the endpoints clamped). This is where the
 * normalisation happens; the underlying units are documented per Flood_D
 * source line so any future scientific tuning has a clear anchor.
 *
 * @source docs/Flood_D_final.js (runRainRiskIndex:3541, unitScale calls throughout 3600s)
 * @rule   architecture doc §16 — never call the output a "probability"
 */

const RISK_WEIGHTS = Object.freeze({
    rain24h: 0.28,
    handInverse: 0.28,
    twi: 0.17,
    slopeInverse: 0.1,
    hydroDistance: 0.1,
    builtInverse: 0.07,
});

/**
 * Locked unitScale ranges (Flood_D:3635, 3639, 3688, 3704, 3719).
 * `min` maps → 0, `max` maps → 1, values outside are clamped.
 */
const UNIT_SCALES = Object.freeze({
    rain24h: { min: 0, max: 300 },
    rain7d: { min: 0, max: 500 },
    handInverseMax: 25,
    slopeInverseMax: 20,
    twiMax: 20,
    hydroMaxDistanceM: 2000,
});

const PROBABILITY_CALIBRATED = false;

/**
 * Sanity check that the six weights add to 1 (±ε). Runs once at module load.
 */
function _assertWeightsSum() {
    const sum = Object.values(RISK_WEIGHTS).reduce((acc, v) => acc + v, 0);
    if (Math.abs(sum - 1) > 1e-6) {
        throw new Error(`rain.risk-model: RISK_WEIGHTS sum to ${sum}, expected 1.0`);
    }
}
_assertWeightsSum();

/**
 * Clamp `image` to [min, max], then map linearly to [0, 1].
 */
function unitScale(ee, image, { min, max }) {
    if (!ee) {
        throw new Error('rain.risk-model.unitScale requires the ee module');
    }
    if (!image) {
        throw new Error('rain.risk-model.unitScale requires an image');
    }
    if (!Number.isFinite(min) || !Number.isFinite(max) || max === min) {
        throw new Error('rain.risk-model.unitScale requires numeric min/max with max ≠ min');
    }
    return image
        .max(min)
        .min(max)
        .subtract(min)
        .divide(max - min);
}

/**
 * Invert a 0..1 factor (e.g. `1 - x` for HAND / slope / built where LOWER
 * values raise flood risk).
 */
function invert01(ee, image) {
    if (!ee) {
        throw new Error('rain.risk-model.invert01 requires the ee module');
    }
    if (!image) {
        throw new Error('rain.risk-model.invert01 requires an image');
    }
    return ee.Image(1).subtract(image);
}

/**
 * Combine the six weighted factors into a single 0..1 risk score.
 *
 * @param {object} ee
 * @param {object} inputs
 * @param {object} inputs.rain24h       — 24h rainfall accumulation (mm)
 * @param {object} inputs.handImage     — HAND (m)
 * @param {object} inputs.twiImage      — Topographic Wetness Index
 * @param {object} inputs.slopeDeg      — slope in degrees
 * @param {object} inputs.hydroDistance — distance-from-water (m) — pixels close to water score higher
 * @param {object} inputs.builtDensity  — 0..1 focal-mean of DW built
 * @returns {object} ee.Image (`rain_risk_score`, 0..1)
 */
function combineFactors(
    ee,
    { rain24h, handImage, twiImage, slopeDeg, hydroDistance, builtDensity } = {},
) {
    if (!ee) {
        throw new Error('rain.risk-model.combineFactors requires the ee module');
    }
    for (const [name, val] of Object.entries({
        rain24h,
        handImage,
        twiImage,
        slopeDeg,
        hydroDistance,
        builtDensity,
    })) {
        if (!val) {
            throw new Error(`rain.risk-model.combineFactors requires ${name}`);
        }
    }

    const fRain = unitScale(ee, rain24h, UNIT_SCALES.rain24h);
    const fHand = invert01(
        ee,
        unitScale(ee, handImage, { min: 0, max: UNIT_SCALES.handInverseMax }),
    );
    const fTwi = unitScale(ee, twiImage, { min: 0, max: UNIT_SCALES.twiMax });
    const fSlope = invert01(
        ee,
        unitScale(ee, slopeDeg, { min: 0, max: UNIT_SCALES.slopeInverseMax }),
    );
    // Hydrological "closeness" — invert the distance factor.
    const fHydro = invert01(
        ee,
        unitScale(ee, hydroDistance, { min: 0, max: UNIT_SCALES.hydroMaxDistanceM }),
    );
    const fBuilt = invert01(ee, builtDensity); // builtDensity already 0..1

    return fRain
        .multiply(RISK_WEIGHTS.rain24h)
        .add(fHand.multiply(RISK_WEIGHTS.handInverse))
        .add(fTwi.multiply(RISK_WEIGHTS.twi))
        .add(fSlope.multiply(RISK_WEIGHTS.slopeInverse))
        .add(fHydro.multiply(RISK_WEIGHTS.hydroDistance))
        .add(fBuilt.multiply(RISK_WEIGHTS.builtInverse))
        .rename('rain_risk_score');
}

module.exports = {
    RISK_WEIGHTS,
    UNIT_SCALES,
    PROBABILITY_CALIBRATED,
    unitScale,
    invert01,
    combineFactors,
};
