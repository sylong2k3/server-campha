'use strict';

/** M5 per-period Sentinel-1 change detection. */

const sentinel1 = require('../common/sentinel1');
const otsu = require('../common/otsu');
const { TREND_ANALYSIS_SCALE_M, ANALYSIS_CRS } = require('../common/projection');

function toNaturalCollection(ee, collection) {
    return collection
        .select(['VV', 'VH'])
        .map((image) => sentinel1.toNatural(ee, image));
}

function buildReference(ee, collection) {
    const natural = toNaturalCollection(ee, collection);
    const image = natural.median().rename(['VV', 'VH']);
    const db = image.max(1e-6).log10().multiply(10).rename(['VV_db', 'VH_db']);
    return { natural, image, db, count: collection.size() };
}

function resolveRatioThresholds(ee, {
    mode,
    ratioVV,
    ratioVH,
    aoi,
    config,
}) {
    if (mode === 'fixed') {
        return {
            vv: config.floodRatioThresholdVV,
            vh: config.floodRatioThresholdVH,
            usedFallback: 0,
        };
    }
    const helper = mode === 'median_sigma'
        ? otsu.computeMedianSigmaThreshold
        : otsu.otsuThresholdOnBand;
    const common = {
        geometry: aoi,
        maxDb: config.maximumRatio,
        scale: TREND_ANALYSIS_SCALE_M,
        crs: ANALYSIS_CRS,
    };
    const vv = helper(ee, {
        ...common,
        image: ratioVV,
        band: 'ratio_vv',
        minDb: config.floodRatioThresholdVV,
        fallback: config.floodRatioThresholdVV,
        ...(mode === 'median_sigma' ? { k: config.medianSigmaK } : {}),
    });
    const vh = helper(ee, {
        ...common,
        image: ratioVH,
        band: 'ratio_vh',
        minDb: config.floodRatioThresholdVH,
        fallback: config.floodRatioThresholdVH,
        ...(mode === 'median_sigma' ? { k: config.medianSigmaK } : {}),
    });
    return {
        vv: vv.threshold,
        vh: vh.threshold,
        usedFallback: ee.Number(vv.usedFallback).max(vh.usedFallback),
    };
}

function emptyFlood(ee) {
    return ee.Image.constant(0).rename('flood').toByte().selfMask();
}

function buildPeriodFlood(ee, {
    period,
    aoi,
    orbit,
    reference,
    terrain,
    hand,
    water,
    mining,
    config,
    dynamicWorldContext = null,
}) {
    const fetchStart = ee.Date(period.start).advance(-config.periodPadDays, 'day');
    const fetchEnd = ee.Date(period.end).advance(config.periodPadDays, 'day');
    const currentDbCollection = sentinel1.getS1Collection(ee, {
        start: fetchStart,
        end: fetchEnd,
        aoi,
        pass: orbit.orbitPass,
        relativeOrbit: orbit.relativeOrbit,
    });
    const currentCount = currentDbCollection.size();
    const valid = ee.Number(reference.count.gt(0).and(currentCount.gt(0)));
    const current = toNaturalCollection(ee, currentDbCollection)
        .median()
        .rename(['VV', 'VH']);
    const currentDb = current.max(1e-6).log10().multiply(10).rename(['VV_db', 'VH_db']);
    const ratioVV = reference.image.select('VV').divide(current.select('VV')).rename('ratio_vv');
    const ratioVH = reference.image.select('VH').divide(current.select('VH')).rename('ratio_vh');
    const thresholds = resolveRatioThresholds(ee, {
        mode: config.ratioThresholdMode,
        ratioVV,
        ratioVH,
        aoi,
        config,
    });

    const support = ratioVV
        .gt(thresholds.vv)
        .add(currentDb.select('VH_db').lt(-18))
        .add(currentDb.select('VV_db').lt(-11));
    const darkFlood = ratioVH.gt(thresholds.vh).and(support.gte(3));
    let urbanFlood = ee.Image.constant(0);
    if (config.enableUrbanDoubleBounce && dynamicWorldContext) {
        const vvIncreaseDb = currentDb.select('VV_db').subtract(reference.db.select('VV_db'));
        urbanFlood = dynamicWorldContext.builtDensity
            .gte(0.5)
            .and(vvIncreaseDb.gt(1.5))
            .and(terrain.slope.lte(10))
            .and(hand.hand.lte(15))
            .and(mining.mask.not());
    }

    let refined = darkFlood
        .and(mining.mask.not())
        .or(urbanFlood)
        .updateMask(terrain.slope.lt(config.slopeThreshold))
        .updateMask(hand.hand.lte(config.handThreshold).unmask(0))
        .updateMask(water.permanent.not().unmask(1));
    const connected = refined.selfMask().connectedPixelCount(100, true);
    refined = refined
        .updateMask(connected.gte(8))
        .rename('flood')
        .toByte()
        .clip(aoi);

    return ee.Image(ee.Algorithms.If(valid.eq(1), refined, emptyFlood(ee)))
        .rename('flood')
        .set('system:time_start', ee.Date(period.start).millis())
        .set('period_start', period.start)
        .set('period_end', period.end)
        .set('period', `${period.start}_${period.end}`)
        .set('image_count', currentCount)
        .set('threshold_vv', thresholds.vv)
        .set('threshold_vh', thresholds.vh)
        .set('threshold_fallback', thresholds.usedFallback)
        .set('valid', valid);
}

module.exports = {
    toNaturalCollection,
    buildReference,
    resolveRatioThresholds,
    emptyFlood,
    buildPeriodFlood,
};
