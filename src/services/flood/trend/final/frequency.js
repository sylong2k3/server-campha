'use strict';

/**
 * Flood frequency aggregation for FINAL M5.
 *
 * FINAL uses count-based thresholding (>= freqAlertMin periods) rather than
 * percent-based (>= 50 %) as in V1. This is more robust when some seasons
 * have no Sentinel-1 imagery.
 *
 * @ported-from final_code.js §13, §14, §15, §16, §20, §21
 */

/**
 * Build flood frequency products.
 *
 * @param {object} ee
 * @param {object} args
 * @param {object[]} args.periodImages    — ee.Image array, one per season (with 'valid' property)
 * @param {object}   args.validCount      — ee.Number: number of seasons with valid S1 data
 * @param {number}   args.freqAlertMin    — seasons threshold for "frequent" (default 2)
 * @returns {{ frequencyCount, floodExtent, frequentFlood, floodFrequencyPercent, validCollection }}
 */
function buildFloodFrequency(ee, { periodImages, validCount, freqAlertMin }) {
  const floodCollection = ee.ImageCollection(periodImages);

  // Sorted valid subset
  const validCollection = floodCollection
    .filter(ee.Filter.eq('valid', 1))
    .sort('system:time_start');

  // Sum across all periods (valid and invalid, using 0 for invalid)
  const frequencyCount = floodCollection
    .map((image) => ee.Image(image).unmask(0).rename('flood').toByte())
    .sum()
    .rename('flood_frequency');

  // Percentage (divide by valid count to avoid biasing from missing seasons)
  const safeValidCount = ee.Number(validCount).max(1);
  const floodFrequencyPercent = frequencyCount
    .divide(safeValidCount)
    .multiply(100)
    .rename('flood_frequency_percent')
    .toFloat();

  // Flood extent: pixel flooded in >= 1 valid season
  const floodExtent = frequencyCount.gte(1).selfMask().rename('flood_extent').toByte();

  // Frequent flood: pixel flooded in >= freqAlertMin seasons
  const frequentFlood = frequencyCount.gte(freqAlertMin).selfMask()
    .rename('frequent_flood').toByte();

  return { floodCollection, validCollection, frequencyCount, floodFrequencyPercent, floodExtent, frequentFlood };
}

/**
 * Identify pixels newly flooded between the last two valid periods.
 * Returns empty image (masked) if < 2 valid periods.
 *
 * @ported-from final_code.js §15, §16
 */
function buildNewFlood(ee, { validCollection, validCount }) {
  const empty = ee.Image.constant(0).rename('flood').toByte()
    .updateMask(ee.Image.constant(0));

  const padded = ee.List(validCollection.toList(validCount)).cat([empty, empty]);

  const lastIdx     = ee.Number(validCount).subtract(1).max(0);
  const previousIdx = ee.Number(validCount).subtract(2).max(0);

  const lastFlood     = ee.Image(padded.get(lastIdx)).unmask(0);
  const previousFlood = ee.Image(padded.get(previousIdx)).unmask(0);

  const calculated = lastFlood.and(previousFlood.not()).selfMask().rename('new_flood').toByte();

  return ee.Image(ee.Algorithms.If(
    ee.Number(validCount).gte(2),
    calculated,
    empty.rename('new_flood'),
  )).toByte();
}

module.exports = { buildFloodFrequency, buildNewFlood };
