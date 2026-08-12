'use strict';

/**
 * Small-object removal + opening/closing morphology for the M1 flood mask.
 *
 * Two locked knobs:
 *   - MIN_CLUSTER_PIXELS = 8-connectivity, minimum area from Flood_D:2244
 *   - MORPHOLOGY_RADIUS_M = focal-min then focal-max radius, Flood_D:2858
 *
 * @source docs/Flood_D_final.js (removeSmallFloodObjects:2244; morphology block:2856)
 */

/** Max neighbours reached by connectedPixelCount (Flood_D:2250). */
const CONNECTED_PIXEL_MAX = 256;

/** Morphology opening radius in metres (Flood_D:2858). */
const MORPHOLOGY_RADIUS_M = 10;

/**
 * Drop pixel clusters smaller than `minAreaM2` (Flood_D:2244–2274).
 * Uses connectedPixelCount with 8-neighbour connectivity, then thresholds by
 * cluster area (px × pixel_area_m²).
 *
 * @param {object} ee
 * @param {object} args
 * @param {object} args.floodMask     — binary ee.Image
 * @param {number} args.minAreaM2     — threshold in m² (default 1000, Flood_D:188)
 * @param {number} [args.pixelAreaM2] — override pixel area (defaults to 30×30 = 900)
 * @returns {object} ee.Image (binary, small clusters removed)
 */
function removeSmallFloodObjects(ee, { floodMask, minAreaM2, pixelAreaM2 = 900 } = {}) {
    if (!ee) {
        throw new Error('event.morphology.removeSmallFloodObjects requires the ee module');
    }
    if (!floodMask) {
        throw new Error('event.morphology.removeSmallFloodObjects requires a floodMask');
    }
    if (!Number.isFinite(minAreaM2) || minAreaM2 <= 0) {
        throw new Error('event.morphology.removeSmallFloodObjects requires a positive minAreaM2');
    }
    const minPixels = Math.ceil(minAreaM2 / pixelAreaM2);
    // connectedPixelCount(maxSize, eightConnected)
    const clusterSize = floodMask.selfMask().connectedPixelCount(CONNECTED_PIXEL_MAX, true);
    return clusterSize.gte(minPixels).rename('flood_mask');
}

/**
 * Morphological close-then-open (Flood_D:2856–2864). Cleans salt-and-pepper
 * artefacts left by the classifier without eroding real flood extents.
 *
 * @param {object} ee
 * @param {object} args
 * @param {object} args.mask                       — binary ee.Image
 * @param {number} [args.radiusMeters=MORPHOLOGY_RADIUS_M]
 * @returns {object} ee.Image (binary)
 */
function openClose(ee, { mask, radiusMeters = MORPHOLOGY_RADIUS_M } = {}) {
    if (!ee) {
        throw new Error('event.morphology.openClose requires the ee module');
    }
    if (!mask) {
        throw new Error('event.morphology.openClose requires a mask');
    }
    // Close (dilate then erode) — fills small gaps
    const closed = mask
        .focal_max(radiusMeters, 'circle', 'meters')
        .focal_min(radiusMeters, 'circle', 'meters');
    // Open (erode then dilate) — removes small islands
    return closed
        .focal_min(radiusMeters, 'circle', 'meters')
        .focal_max(radiusMeters, 'circle', 'meters')
        .rename('flood_mask');
}

module.exports = {
    CONNECTED_PIXEL_MAX,
    MORPHOLOGY_RADIUS_M,
    removeSmallFloodObjects,
    openClose,
};
