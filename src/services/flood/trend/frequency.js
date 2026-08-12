'use strict';

function buildFrequencyProducts(ee, { floodCollection, tidalUncertainty, frequencyAlertPercent }) {
    const validCollection = floodCollection
        .filter(ee.Filter.eq('valid', 1))
        .sort('system:time_start');
    const validCount = validCollection.size();
    const frequencyCount = floodCollection
        .map((image) => ee.Image(image).unmask(0).rename('flood').toByte())
        .sum()
        .rename('trend_frequency_count');
    const frequencyPercent = frequencyCount
        .divide(ee.Number(validCount).max(1))
        .multiply(100)
        .rename('trend_frequency');
    const anyFlood = frequencyCount.gt(0);
    const frequent = frequencyPercent.gte(frequencyAlertPercent);
    return {
        validCollection,
        validCount,
        frequencyCount,
        frequencyPercent,
        anyFloodNonTidal: anyFlood.and(tidalUncertainty.not()).selfMask().rename('trend_any_flood'),
        frequentNonTidal: frequent
            .and(tidalUncertainty.not())
            .selfMask()
            .rename('trend_frequent_flood'),
        tidalCandidate: anyFlood.and(tidalUncertainty).selfMask().rename('trend_tidal_candidate'),
    };
}

function buildNewFlood(ee, { validCollection, validCount, tidalUncertainty }) {
    const empty = ee.Image.constant(0).rename('flood').toByte().selfMask();
    const padded = ee.List(validCollection.toList(validCount)).cat([empty, empty]);
    const last = ee.Image(padded.get(ee.Number(validCount).subtract(1).max(0))).unmask(0);
    const previous = ee.Image(padded.get(ee.Number(validCount).subtract(2).max(0))).unmask(0);
    const calculated = last.and(previous.not()).selfMask();
    const newFlood = ee.Image(ee.Algorithms.If(ee.Number(validCount).gte(2), calculated, empty));
    return newFlood.and(tidalUncertainty.not()).selfMask().rename('trend_new_flood');
}

module.exports = { buildFrequencyProducts, buildNewFlood };
