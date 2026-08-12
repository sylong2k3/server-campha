'use strict';

/** M5 orchestrator: multi-period frequency, change and validation. */

const { TREND_DEFAULTS } = require('../config/defaults');
const versions = require('../config/versions');
const { assertValidMode, shouldEnableDiagnostics } = require('../config/product-vs-calibration');
const geometry = require('../common/geometry');
const sentinel1 = require('../common/sentinel1');
const terrain = require('../common/terrain');
const hand = require('../common/hand');
const waterMasks = require('../common/water-masks');
const miningMask = require('../common/mining-mask');
const dynamicWorld = require('../common/dynamic-world');
const orbitSelection = require('../event/orbit-selection');
const periodAnalysis = require('./period-analysis');
const frequency = require('./frequency');
const landChange = require('./land-change');
const accuracy = require('../accuracy/surface-water');
const result = require('./result');

function defaultDeps() {
    return {
        geometry,
        sentinel1,
        terrain,
        hand,
        waterMasks,
        miningMask,
        dynamicWorld,
        orbitSelection,
        periodAnalysis,
        frequency,
        landChange,
        accuracy,
        result,
    };
}

function mergePeriodCollections(ee, deps, { periods, aoi, pass }) {
    let merged = deps.sentinel1.getS1Collection(ee, {
        start: periods[0].start,
        end: periods[0].end,
        aoi,
        pass,
    });
    for (const period of periods.slice(1)) {
        merged = merged.merge(deps.sentinel1.getS1Collection(ee, {
            start: period.start,
            end: period.end,
            aoi,
            pass,
        }));
    }
    return merged;
}

async function runTrendAnalysis({
    ee,
    geeAdapter,
    runConfig,
    runMode = 'product',
    authoritativeGeoJson = null,
    deps = defaultDeps(),
} = {}) {
    if (!ee) {throw new Error('trend.index.runTrendAnalysis requires the ee module');}
    if (!geeAdapter?.evaluate) {throw new Error('trend.index.runTrendAnalysis requires geeAdapter.evaluate');}
    if (!runConfig) {throw new Error('trend.index.runTrendAnalysis requires runConfig');}
    assertValidMode(runMode);
    const config = { ...TREND_DEFAULTS, ...runConfig, mode: runMode };
    if (!Array.isArray(config.periods) || config.periods.length < 2) {
        throw new Error('trend.index.runTrendAnalysis requires at least two periods');
    }

    const { geometry: aoi, source: aoiSource } = deps.geometry.loadAoi(ee, {
        authoritativeGeoJson,
    });
    const dryCandidates = deps.sentinel1.getS1Collection(ee, {
        start: config.dryStart,
        end: config.dryEnd,
        aoi,
        pass: config.orbitPass,
    });
    const wetCandidates = mergePeriodCollections(ee, deps, {
        periods: config.periods,
        aoi,
        pass: config.orbitPass,
    });
    const orbit = await deps.orbitSelection.chooseBestS1Orbit(ee, {
        preCollection: dryCandidates,
        postCollection: wetCandidates,
        geeAdapter,
    });
    if (!orbit) {
        return {
            artifacts: {},
            catalog: [],
            metadata: {
                pipelineVersion: versions.pipelineVersionFor('trend'),
                configVersion: versions.CONFIG_VERSION,
                aoiSource,
                warnings: ['NO_SAR_ORBIT_MATCH'],
            },
            diagnostics: null,
        };
    }

    const dryCollection = deps.sentinel1.getS1Collection(ee, {
        start: config.dryStart,
        end: config.dryEnd,
        aoi,
        pass: orbit.orbitPass,
        relativeOrbit: orbit.relativeOrbit,
    });
    const reference = deps.periodAnalysis.buildReference(ee, dryCollection);
    const terrainStack = deps.terrain.buildTerrainStack(ee);
    const handStack = deps.hand.buildHandStack(ee, terrainStack.slope);
    const waterStack = deps.waterMasks.buildWaterStack(ee, {
        elevationImage: terrainStack.elevation,
    });
    const miningStack = deps.miningMask.createMiningMask(ee, {
        slopeDeg: terrainStack.slope,
        handImage: handStack.hand,
        elevationImage: terrainStack.elevation,
    });
    const dwCache = deps.dynamicWorld.createRunCache();
    const oldContext = dwCache.get(ee, {
        startDate: `${config.dynamicWorldYearOld}-01-01`,
        endDate: `${config.dynamicWorldYearOld + 1}-01-01`,
        aoi,
    });
    const newContext = dwCache.get(ee, {
        startDate: `${config.dynamicWorldYearNew}-01-01`,
        endDate: `${config.dynamicWorldYearNew + 1}-01-01`,
        aoi,
    });

    const periodImages = config.periods.map((period) => deps.periodAnalysis.buildPeriodFlood(ee, {
        period,
        aoi,
        orbit,
        reference,
        terrain: terrainStack,
        hand: handStack,
        water: waterStack,
        mining: miningStack,
        config,
        dynamicWorldContext: dwCache.get(ee, {
            startDate: `${period.start.slice(0, 4)}-01-01`,
            endDate: `${Number(period.start.slice(0, 4)) + 1}-01-01`,
            aoi,
        }),
    }));
    const floodCollection = ee.ImageCollection(periodImages);
    const frequencyProducts = deps.frequency.buildFrequencyProducts(ee, {
        floodCollection,
        tidalUncertainty: waterStack.tidalUncertainty,
        frequencyAlertPercent: config.frequencyAlertPercent,
    });
    const newFlood = deps.frequency.buildNewFlood(ee, {
        validCollection: frequencyProducts.validCollection,
        validCount: frequencyProducts.validCount,
        tidalUncertainty: waterStack.tidalUncertainty,
    });
    const landProducts = deps.landChange.buildLandChangeProducts(ee, {
        oldContext,
        newContext,
        miningMask: miningStack.mask,
        frequencyPercent: frequencyProducts.frequencyPercent,
        terrain: terrainStack,
        hand: handStack,
        config,
        aoi,
    });
    const artifacts = {
        trend_frequency: frequencyProducts.frequencyPercent
            .updateMask(waterStack.tidalUncertainty.not())
            .rename('trend_frequency'),
        trend_frequent_flood: frequencyProducts.frequentNonTidal,
        trend_new_flood: newFlood,
        pond_to_built: landProducts.pondToBuilt,
        drainage_sensitive: landProducts.drainageSensitive,
        encroachment_alert: landProducts.encroachmentAlert,
        trend_tidal_candidate: frequencyProducts.tidalCandidate,
        trend_mining_candidate: frequencyProducts.frequencyCount
            .gt(0)
            .and(miningStack.mask)
            .selfMask()
            .rename('trend_mining_candidate'),
    };

    const validationPeriod = config.periods[config.validationPeriod ?? config.periods.length - 1];
    const assessment = deps.accuracy.assessSurfaceWater(ee, {
        aoi,
        period: validationPeriod,
        orbit,
        sentinel1: deps.sentinel1,
        slope: terrainStack.slope,
        config,
    });
    const [validPeriodCount, assessmentResult] = await Promise.all([
        geeAdapter.evaluate(frequencyProducts.validCount),
        geeAdapter.evaluate(assessment),
    ]);
    const warnings = [
        ...(terrainStack.isFallback ? ['TERRAIN_FELL_BACK_TO_DSM'] : []),
        ...(terrainStack.nonCommercial ? ['NON_COMMERCIAL_DTM_FABDEM'] : []),
        ...(Number(validPeriodCount) < 2 ? ['INSUFFICIENT_VALID_PERIODS_FOR_NEW_FLOOD'] : []),
        ...(assessmentResult?.status === 'INSUFFICIENT_DATA' ? ['ACCURACY_NOT_MEASURED'] : []),
    ];
    return {
        artifacts,
        catalog: deps.result.selectM5Artifacts({ runMode }),
        metadata: {
            pipelineVersion: versions.pipelineVersionFor('trend'),
            configVersion: versions.CONFIG_VERSION,
            aoiSource,
            orbitKey: orbit.orbitKey,
            orbitPass: orbit.orbitPass,
            relativeOrbit: orbit.relativeOrbit,
            drySceneCount: orbit.preCount,
            wetSceneCount: orbit.postCount,
            totalPeriods: config.periods.length,
            validPeriodCount: Number(validPeriodCount),
            thresholdMode: config.ratioThresholdMode,
            floodRatioThresholdVV: config.floodRatioThresholdVV,
            floodRatioThresholdVH: config.floodRatioThresholdVH,
            frequencyAlertPercent: config.frequencyAlertPercent,
            assessment: assessmentResult,
            warnings,
        },
        diagnostics: shouldEnableDiagnostics({ mode: runMode })
            ? { periodCount: config.periods.length, dynamicWorldCacheSize: dwCache.size() }
            : null,
    };
}

module.exports = { runTrendAnalysis, defaultDeps, mergePeriodCollections };
