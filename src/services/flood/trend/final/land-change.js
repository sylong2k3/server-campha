'use strict';

/**
 * Land-cover change detection and drainage risk for FINAL M5.
 *
 * Uses ESRI Global LULC 10m Time Series (not Dynamic World as in V1).
 * ESRI class codes:
 *   1 = Water,  4 = Flooded Vegetation,  7 = Built Area
 *
 * Drainage-sensitive logic:
 *   frequentFlood (>= freqAlertMin) OR lowland (elevation < elevLowland)
 * (replaces V1's local-depression focal_mean approach)
 *
 * @ported-from final_code.js §17, §18, §19
 */

const { ASSETS } = require('../../common/datasets');

// ESRI LULC class codes (@dataset ASSETS.ESRI_LULC_TS)
const ESRI_WATER          = 1;
const ESRI_FLOODED_VEG    = 4;
const ESRI_BUILT          = 7;

/**
 * Load ESRI LULC mosaic for a given year (safe: returns empty if no imagery).
 */
function loadEsriLulc(ee, { year, aoi }) {
  const col = ee.ImageCollection(ASSETS.ESRI_LULC_TS)
    .filterDate(`${year}-01-01`, `${year}-12-31`)
    .filterBounds(aoi);
  return ee.Image(
    ee.Algorithms.If(col.size().gt(0), col.mosaic(), ee.Image.constant(0)),
  ).clip(aoi);
}

/**
 * Build land-change products (pond→built, drainage-sensitive, encroachment alert).
 *
 * @param {object} ee
 * @param {object} args
 * @param {object} args.aoi
 * @param {object} args.elevation         — DEM image (metres)
 * @param {object} args.frequencyCount    — flood frequency count image
 * @param {object} args.config            — merged FINAL config
 * @returns {{ pondToBuilt, drainageSensitive, encroachmentAlert }}
 */
function buildLandChangeProducts(ee, { aoi, elevation, frequencyCount, config }) {
  // ── Load ESRI LULC ─────────────────────────────────────────────────────
  const oldLc = loadEsriLulc(ee, { year: config.lcYearOld, aoi });
  const newLc = loadEsriLulc(ee, { year: config.lcYearNew, aoi });

  // Pixels that were water or flooded vegetation in the older year
  const wasWater = oldLc.eq(ESRI_WATER).or(oldLc.eq(ESRI_FLOODED_VEG));
  // Pixels classified as built in the newer year
  const isBuilt  = newLc.eq(ESRI_BUILT);

  // Pond/water-body → built conversion
  const pondToBuilt = wasWater.and(isBuilt).selfMask()
    .rename('pond_to_built').toByte().clip(aoi);

  // ── Drainage-sensitive ─────────────────────────────────────────────────
  // FINAL: frequent flood OR low elevation (no local-depression computation)
  const lowland         = elevation.lt(config.elevLowland);
  const frequentFlood   = frequencyCount.gte(config.freqAlertMin);
  const drainageSensitive = frequentFlood.or(lowland)
    .rename('drainage_sensitive').toByte().clip(aoi);

  // Encroachment alert: water→built AND inside drainage-sensitive zone
  const encroachmentAlert = pondToBuilt
    .updateMask(drainageSensitive).selfMask()
    .rename('encroachment_alert').toByte().clip(aoi);

  return { pondToBuilt, drainageSensitive, encroachmentAlert };
}

module.exports = {
  ESRI_WATER,
  ESRI_FLOODED_VEG,
  ESRI_BUILT,
  loadEsriLulc,
  buildLandChangeProducts,
};
