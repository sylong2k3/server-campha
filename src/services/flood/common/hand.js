'use strict';

/**
 * MERIT Hydro helpers — HAND, UPA (upstream pixel area), TWI (topographic
 * wetness index), and flow direction.
 *
 * HAND (height above nearest drainage) is the workhorse for the flood
 * eligibility gate in M1 (hardMaximumHAND = 12 m per Flood_D:183) and the
 * scenario mask in M2 (levelM = 5 m per Flood_D:227).
 *
 * @source docs/Flood_D_final.js (line 656; hand ≤ 12 m gate at 183; TWI at 730)
 * @dataset ASSETS.MERIT_HYDRO
 * @rule    architecture doc §15 (thresholds locked)
 */

const { ASSETS } = require('./datasets');

/** Guard values that appear in Flood_D. */
const TAN_SLOPE_FLOOR = 0.001; // Flood_D:730
const UPA_LOG_EPSILON = 0.001; // Flood_D:734

/**
 * Load the MERIT/Hydro image (raster with `hnd`, `upa`, `dir` bands).
 */
function loadMeritHydro(ee) {
    if (!ee) {
        throw new Error('hand.loadMeritHydro requires the ee module');
    }
    return ee.Image(ASSETS.MERIT_HYDRO);
}

/**
 * HAND band (metres). Not every pixel has a defined HAND — coastal / karst
 * / very-low-relief pixels are masked in MERIT. `handMissingArea` reports the
 * uncovered fraction; the flood pipeline logs it as a warning.
 */
function handImage(ee, meritImage = null) {
    if (!ee) {
        throw new Error('hand.handImage requires the ee module');
    }
    const merit = meritImage || loadMeritHydro(ee);
    return merit.select('hnd').rename('HAND');
}

/**
 * Upstream pixel area (km²).
 */
function upaImage(ee, meritImage = null) {
    if (!ee) {
        throw new Error('hand.upaImage requires the ee module');
    }
    const merit = meritImage || loadMeritHydro(ee);
    return merit.select('upa').rename('UPA');
}

/**
 * Topographic Wetness Index — ln(UPA / tan(slope)), with the standard guards
 * against tan(0) and ln(0).
 *
 * TWI needs the slope image because MERIT is used with any DTM's slope
 * (`slope` from terrain.buildTerrainStack).
 *
 * @param {object} ee
 * @param {object} slopeDeg  — slope image in degrees (from terrain module)
 * @param {object} [meritImage] — optional pre-loaded MERIT image (avoids a
 *                                 second Image() call).
 */
function twiImage(ee, slopeDeg, meritImage = null) {
    if (!ee) {
        throw new Error('hand.twiImage requires the ee module');
    }
    if (!slopeDeg) {
        throw new Error('hand.twiImage requires the slope image');
    }
    const upa = upaImage(ee, meritImage);
    const tanSlope = slopeDeg
        .multiply(Math.PI / 180)
        .tan()
        .max(TAN_SLOPE_FLOOR);
    return upa.add(UPA_LOG_EPSILON).log().divide(tanSlope).rename('TWI');
}

/**
 * Bundle every MERIT-derived layer M1/M2/M3 might want.
 */
function buildHandStack(ee, slopeDeg) {
    const merit = loadMeritHydro(ee);
    return {
        hand: handImage(ee, merit),
        upa: upaImage(ee, merit),
        twi: twiImage(ee, slopeDeg, merit),
        flowDirection: merit.select('dir').rename('flow_dir'),
    };
}

module.exports = {
    TAN_SLOPE_FLOOR,
    UPA_LOG_EPSILON,
    loadMeritHydro,
    handImage,
    upaImage,
    twiImage,
    buildHandStack,
};
