'use strict';

/**
 * Flood frequency aggregation for M5 monitoring model.
 *
 * In the single-period monitoring model the collection contains exactly one
 * image, so frequencyCount is either 0 or 1.  The count-based threshold
 * (>= freqAlertMin, defaulting to 1) remains the same logic as the previous
 * multi-season FINAL model — it just always resolves to binary in practice.
 */

/**
 * Build flood frequency products.
 *
 * @param {object} ee
 * @param {object} args
 * @param {object[]} args.periodImages    — ee.Image array (one image in monitoring model)
 * @param {object}   args.validCount      — ee.Number: number of periods with valid S1 data
 * @param {number}   args.freqAlertMin    — detection threshold (default 1 in monitoring model)
 * @returns {{ floodCollection, validCollection, frequencyCount, floodFrequencyPercent, floodExtent, frequentFlood }}
 */
function buildFloodFrequency(ee, { periodImages, validCount, freqAlertMin }) {
  const floodCollection = ee.ImageCollection(periodImages);

  const validCollection = floodCollection
    .filter(ee.Filter.eq('valid', 1))
    .sort('system:time_start');

  // Sum across all periods (0 for periods with no valid imagery)
  const frequencyCount = floodCollection
    .map((image) => ee.Image(image).unmask(0).rename('flood').toByte())
    .sum()
    .rename('flood_frequency');

  const safeValidCount = ee.Number(validCount).max(1);
  const floodFrequencyPercent = frequencyCount
    .divide(safeValidCount)
    .multiply(100)
    .rename('flood_frequency_percent')
    .toFloat();

  // Flood extent: detected in >= 1 period
  const floodExtent = frequencyCount.gte(1).selfMask().rename('flood_extent').toByte();

  // Frequent flood: detected in >= freqAlertMin periods
  // With freqAlertMin=1 this equals floodExtent; kept for config flexibility.
  const frequentFlood = frequencyCount.gte(freqAlertMin).selfMask()
    .rename('frequent_flood').toByte();

  return { floodCollection, validCollection, frequencyCount, floodFrequencyPercent, floodExtent, frequentFlood };
}

module.exports = { buildFloodFrequency };
