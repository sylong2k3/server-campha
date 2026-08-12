'use strict';

/** Sentinel-2 MNDWI validation for M5 surface-water mapping. */

const { ASSETS } = require('../common/datasets');

function assessSurfaceWater(ee, {
    aoi,
    period,
    orbit,
    sentinel1,
    slope,
    config,
}) {
    const start = ee.Date(period.start).advance(-config.s2ExtraDays, 'day');
    const end = ee.Date(period.end).advance(config.s2ExtraDays + 1, 'day');
    const cloudScores = ee.ImageCollection(ASSETS.CLOUD_SCORE_PLUS);
    const s2 = ee
        .ImageCollection(ASSETS.SENTINEL2_SR_HARMONIZED)
        .filterBounds(aoi)
        .filterDate(start, end)
        .linkCollection(cloudScores, ['cs_cdf'])
        .map((image) => image.updateMask(image.select('cs_cdf').gte(config.s2ClearThreshold)));
    const s1 = sentinel1.getS1Collection(ee, {
        start: period.start,
        end: period.end,
        aoi,
        pass: orbit.orbitPass,
        relativeOrbit: orbit.relativeOrbit,
    });
    const s2Count = s2.size();
    const s1Count = s1.size();
    const reference = s2
        .median()
        .normalizedDifference(['B3', 'B11'])
        .gt(config.mndwiThreshold)
        .rename('reference');
    const sarDb = s1.median();
    let classified;
    if (config.waterCriterion === 'VV_AND_VH') {
        classified = sarDb.select('VV').lt(config.waterVVDbFallback)
            .and(sarDb.select('VH').lt(config.waterVHDbFallback));
    } else if (config.waterCriterion === 'VV_OR_VH') {
        classified = sarDb.select('VV').lt(config.waterVVDbFallback)
            .or(sarDb.select('VH').lt(config.waterVHDbFallback));
    } else {
        classified = sarDb.select('VH').lt(config.waterVHDbFallback);
    }
    const stack = reference
        .addBands(classified.rename('classified'))
        .updateMask(slope.lt(config.slopeThreshold));
    const samples = stack.stratifiedSample({
        numPoints: config.samplesPerClass,
        classBand: 'reference',
        region: aoi,
        scale: 20,
        seed: config.sampleSeed,
        geometries: false,
    });
    const matrix = samples.errorMatrix('reference', 'classified');
    const hasData = ee.Number(s2Count).gt(0).and(ee.Number(s1Count).gt(0));
    return ee.Dictionary({
        assessmentType: 'surface_water_mapping',
        validationPeriod: `${period.start}_${period.end}`,
        s2ClearScenes: s2Count,
        s1Scenes: s1Count,
        overallAccuracy: ee.Algorithms.If(hasData, matrix.accuracy(), -1),
        kappa: ee.Algorithms.If(hasData, matrix.kappa(), -1),
        status: ee.Algorithms.If(hasData, 'MEASURED', 'INSUFFICIENT_DATA'),
    });
}

module.exports = { assessSurfaceWater };
