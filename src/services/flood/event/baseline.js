'use strict';

/**
 * Pre-event Sentinel-1 baseline + scale (M1 event module).
 *
 * The baseline is the "normal state" the classifier subtracts the post-event
 * image from. The scale is a per-pixel robust-sigma estimator (MAD × 1.4826)
 * used by the median-sigma threshold path in the classifier.
 *
 * @source docs/Flood_D_final.js (createS1Baseline:1914, createS1BaselineScale:1930)
 * @rule   architecture doc §15 (locked constants)
 */

/**
 * MAD → sigma constant (Flood_D:1935). For a Gaussian, sigma ≈ 1.4826 × MAD.
 */
const MAD_TO_SIGMA = 1.4826;

/**
 * Floors for the per-pixel scale image (Flood_D:1945).
 * VV floor is looser than VH because VV is intrinsically noisier.
 */
const SCALE_FLOOR_VV = 0.75;
const SCALE_FLOOR_VH = 1.0;

/**
 * Median composite of pre-event VV+VH (Flood_D:1914).
 * Consumers pass the FULLY-PREPARED pre-event ImageCollection from
 * `services/flood/common/sentinel1.getS1Collection`.
 *
 * @param {object} ee
 * @param {object} preCollection — ee.ImageCollection (pre-event S1)
 * @returns {object} ee.Image (baseline VV + VH)
 */
function createS1Baseline(ee, preCollection) {
    if (!ee) {throw new Error('event.baseline.createS1Baseline requires the ee module');}
    if (!preCollection) {
        throw new Error('event.baseline.createS1Baseline requires a preCollection');
    }
    return preCollection.select(['VV', 'VH']).median().rename(['VV', 'VH']);
}

/**
 * Per-pixel scale image: MAD × MAD_TO_SIGMA, floored per-band.
 * Used by the classifier's median_sigma threshold path.
 *
 * @param {object} ee
 * @param {object} preCollection — ee.ImageCollection (pre-event S1)
 * @param {object} baseline      — output of createS1Baseline
 * @returns {object} ee.Image (VV_scale + VH_scale)
 */
function createS1BaselineScale(ee, preCollection, baseline) {
    if (!ee) {throw new Error('event.baseline.createS1BaselineScale requires the ee module');}
    if (!preCollection || !baseline) {
        throw new Error('event.baseline.createS1BaselineScale requires preCollection + baseline');
    }
    const deviations = preCollection.map((img) => img.select(['VV', 'VH']).subtract(baseline).abs());
    const mad = deviations.median();
    const vvScale = mad.select('VV').multiply(MAD_TO_SIGMA).max(SCALE_FLOOR_VV).rename('VV_scale');
    const vhScale = mad.select('VH').multiply(MAD_TO_SIGMA).max(SCALE_FLOOR_VH).rename('VH_scale');
    return vvScale.addBands(vhScale);
}

module.exports = {
    MAD_TO_SIGMA,
    SCALE_FLOOR_VV,
    SCALE_FLOOR_VH,
    createS1Baseline,
    createS1BaselineScale,
};
