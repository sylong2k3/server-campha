'use strict';

/**
 * Per-period flood detection for FINAL M5.
 *
 * Algorithm (VH-only, Otsu dynamic threshold, 3-stratum):
 *   1. Fetch Sentinel-1 VH with periodPadDays on each side.
 *   2. Convert dB → natural, apply 50 m focalMean smoothing.
 *   3. Median composite → currentImage.
 *   4. ratio = referenceImage / currentImage  (natural-unit ratio).
 *   5. logRatio = log10(ratio), clamped to [otsuLogMin, otsuLogMax].
 *   6. Per-stratum Otsu on logRatio → threshold in ratio space.
 *   7. Non-urban: ratio > threshold → flood candidate.
 *   8. Urban:     currentDb - referenceDb >= urbanDeltaUpDb → flood.
 *   9. Mine:      excluded from product if excludeMineStratumFromProduct.
 *  10. Refine: slope < slopeThresh, HAND <= handThresh, no permanent water,
 *              no mine (when excluded), ephemeral rule, connected pixels >= connMin.
 *
 * @ported-from final_code.js §5, §6, §7, §8, §10, §10B, §10C, §11
 */

const { ASSETS } = require('../../common/datasets');
const { otsuThresholdOnBand } = require('../../common/otsu');
const { ANALYSIS_CRS } = require('../../common/projection');

// Smoothing radius used by FINAL (50 m > V1's 20 m).
const SMOOTH_RADIUS_M = 50;
const CONNECT_MAX = 100;

// ── Helpers ─────────────────────────────────────────────────────────────────

function toNatural(ee, image) {
  return ee.Image(10).pow(ee.Image(image).divide(10))
    .copyProperties(image, ['system:time_start', 'system:index',
      'orbitProperties_pass', 'relativeOrbitNumber_start']);
}

function naturalToDb(ee, imgNatural) {
  return ee.Image(imgNatural).max(1e-9).log10().multiply(10);
}

/**
 * Fetch VH-only Sentinel-1 collection for a date window.
 * Returns natural-unit images with 50 m focal-mean smoothing applied.
 */
function getS1NaturalVH(ee, { start, end, aoi, orbitPass = 'ASCENDING' }) {
  const raw = ee.ImageCollection(ASSETS.SENTINEL1_GRD)
    .filterBounds(aoi)
    .filterDate(start, end)
    .filter(ee.Filter.eq('instrumentMode', 'IW'))
    .filter(ee.Filter.listContains('transmitterReceiverPolarisation', 'VH'))
    .filter(ee.Filter.eq('orbitProperties_pass', orbitPass))
    .filter(ee.Filter.eq('resolution_meters', 10))
    .select(['VH']);

  return raw.map((image) => {
    const natural = toNatural(ee, ee.Image(image));
    const smoothed = natural.focalMean({
      radius: SMOOTH_RADIUS_M,
      kernelType: 'circle',
      units: 'meters',
      iterations: 1,
    });
    return smoothed.rename('VH')
      .copyProperties(image, ['system:time_start', 'system:index',
        'orbitProperties_pass', 'relativeOrbitNumber_start']);
  });
}

function emptyVHImage(ee) {
  return ee.Image.constant(0).rename('VH').toFloat().updateMask(ee.Image.constant(0));
}

function emptyFloodImage(ee) {
  return ee.Image.constant(0).rename('flood').toByte().updateMask(ee.Image.constant(0));
}

/**
 * Build the dry-season reference image (median of natural-unit VH).
 */
function buildReference(ee, { dryStart, dryEnd, aoi, config }) {
  const collection = getS1NaturalVH(ee, {
    start: dryStart,
    end: dryEnd,
    aoi,
    orbitPass: config.orbitPass,
  });
  const count = collection.size();
  const image = ee.Image(ee.Algorithms.If(
    count.gt(0),
    collection.median(),
    emptyVHImage(ee),
  )).rename('VH').toFloat();
  return { image, count };
}

/**
 * Compute FINAL Otsu threshold for one stratum.
 *
 * Otsu is computed on log10(ratio) clamped to [otsuLogMin, otsuLogMax].
 * The result is converted back to ratio space and validated against
 * [otsuRatioMin, otsuRatioMax]. Out-of-range → fallback.
 *
 * @param {object} ee
 * @param {object} ratioImage   — VH ratio image (natural units, NOT log)
 * @param {object} stratumMask  — binary ee.Image (1 = in stratum), or null for whole ROI
 * @param {object} aoi          — ROI geometry
 * @param {object} config       — merged FINAL config
 * @returns {ee.Number}         — threshold in ratio space
 */
function computeOtsuThresholdFinal(ee, ratioImage, stratumMask, aoi, config) {
  const logFallback = Math.log10(config.floodRatioThresh); // ≈ 0.0969

  let logRatio = ratioImage.max(1e-9).log10().rename('logratio');
  if (stratumMask) {
    logRatio = logRatio.updateMask(stratumMask);
  }

  const { threshold: otsuLogThresh } = otsuThresholdOnBand(ee, {
    image: logRatio,
    band: 'logratio',
    scale: config.otsuScale,
    geometry: aoi,
    minDb: config.otsuLogMin,
    maxDb: config.otsuLogMax,
    fallback: logFallback,
  });

  // Convert log-space Otsu → ratio space
  const otsuRatio = ee.Number(10).pow(otsuLogThresh);

  // Validate range
  const inRange = otsuRatio.gte(config.otsuRatioMin)
    .multiply(otsuRatio.lte(config.otsuRatioMax));

  return ee.Number(ee.Algorithms.If(inRange, otsuRatio, config.floodRatioThresh));
}

/**
 * Refine raw flood candidate with terrain, water, and morphology filters.
 *
 * @ported-from final_code.js function refineFlood() §10
 */
function refineFlood(ee, rawFlood, { slope, hand, permanentWater, strata, config }) {
  let mask = ee.Image(rawFlood).rename('flood').toByte().selfMask();

  // Slope filter
  mask = mask.updateMask(slope.lt(config.slopeThresh));

  // HAND filter
  const handMask = hand.lte(config.handThresh).unmask(1); // missing = keep
  mask = mask.updateMask(handMask);

  // Mine polygon exclusion (if polygon provided)
  if (config.minePolygonAsset && config.minePolygonAsset.trim().length > 0) {
    const mineFc = ee.FeatureCollection(config.minePolygonAsset);
    const mineKeep = ee.Image.constant(1).paint(mineFc, 0).unmask(1);
    mask = mask.updateMask(mineKeep);
  }

  // Mine stratum exclusion from product
  if (config.excludeMineStratumFromProduct) {
    mask = mask.updateMask(strata.mineStratum.not());
  }

  // Ephemeral water exclusion (only when mode='exclude')
  if (config.ephemeralWaterMode === 'exclude') {
    mask = mask.updateMask(strata.ephemeralWater.not());
  }

  // Permanent water removal
  mask = mask.updateMask(permanentWater.not().unmask(1));

  // Connected-pixel filter
  const connected = mask.selfMask().connectedPixelCount(CONNECT_MAX, true);
  mask = mask.updateMask(connected.gte(config.connMin));

  return mask.rename('flood').toByte();
}

/**
 * Detect flood for one seasonal period.
 *
 * @param {object} ee
 * @param {object} args
 * @param {object} args.period           — { label, start, end }
 * @param {object} args.aoi
 * @param {object} args.reference        — { image: ee.Image (VH natural), count: ee.Number }
 * @param {object} args.strata           — output of strata.buildStrata()
 * @param {object} args.slope            — slope image (degrees)
 * @param {object} args.hand             — HAND image (metres)
 * @param {object} args.permanentWater   — binary ee.Image
 * @param {object} args.config           — merged FINAL config
 * @returns {ee.Image}  flood image with metadata properties
 */
function buildPeriodFloodFinal(ee, { period, aoi, reference, strata, slope, hand, permanentWater, config }) {
  const fetchStart = ee.Date(period.start).advance(-config.periodPadDays, 'day');
  const fetchEnd   = ee.Date(period.end).advance(config.periodPadDays, 'day');

  const currentCollection = getS1NaturalVH(ee, {
    start: fetchStart,
    end: fetchEnd,
    aoi,
    orbitPass: config.orbitPass,
  });
  const currentCount = currentCollection.size();

  // Valid = both reference AND current have images
  const valid = reference.count.gt(0).and(currentCount.gt(0));

  const currentImage = ee.Image(ee.Algorithms.If(
    currentCount.gt(0),
    currentCollection.median(),
    emptyVHImage(ee),
  )).rename('VH').toFloat();

  // Ratio in natural-unit space (reference / current)
  const ratio = reference.image.divide(currentImage).rename('ratio');

  // Compute Otsu thresholds per stratum
  const thrNonUrban = ee.Number(ee.Algorithms.If(
    valid,
    computeOtsuThresholdFinal(ee, ratio, strata.nonUrbanStratum, aoi, config),
    config.floodRatioThresh,
  ));
  const thrMine = ee.Number(ee.Algorithms.If(
    valid,
    computeOtsuThresholdFinal(ee, ratio, strata.mineStratum, aoi, config),
    config.floodRatioThresh,
  ));

  // ── Non-urban open-water flood ──────────────────────────────────────────
  const floodNonUrban = ratio.gt(thrNonUrban)
    .updateMask(strata.nonUrbanStratum).unmask(0);

  // ── Mine open-water flood (excluded when config flag set) ───────────────
  const floodMine = config.excludeMineStratumFromProduct
    ? ee.Image.constant(0).toByte()
    : ratio.gt(thrMine).updateMask(strata.mineStratum).unmask(0);

  // ── Urban double-bounce flood ────────────────────────────────────────────
  let urbanFlood = ee.Image.constant(0).toByte();
  if (config.useUrbanFloodLogic) {
    const refDb = naturalToDb(ee, reference.image);
    const curDb = naturalToDb(ee, currentImage);
    const deltaUp = curDb.subtract(refDb);
    urbanFlood = deltaUp.gte(config.urbanDeltaUpDb)
      .updateMask(strata.urbanStratum).unmask(0).toByte();
  }

  // ── Combine ──────────────────────────────────────────────────────────────
  const rawFlood = floodNonUrban.or(floodMine).or(urbanFlood);

  const refined = refineFlood(ee, rawFlood, { slope, hand, permanentWater, strata, config });

  return ee.Image(ee.Algorithms.If(valid, refined, emptyFloodImage(ee)))
    .rename('flood').toByte()
    .set('system:time_start', ee.Date(period.start).millis())
    .set('period_start',   period.start)
    .set('period_end',     period.end)
    .set('season',         period.label || '')
    .set('period',         `${period.start}_${period.end}`)
    .set('image_count',    currentCount)
    .set('otsu_threshold', thrNonUrban)
    .set('otsu_threshold_mine', thrMine)
    .set('urban_logic',    config.useUrbanFloodLogic ? 1 : 0)
    .set('valid',          valid);
}

module.exports = {
  getS1NaturalVH,
  buildReference,
  computeOtsuThresholdFinal,
  refineFlood,
  buildPeriodFloodFinal,
  emptyFloodImage,
};
