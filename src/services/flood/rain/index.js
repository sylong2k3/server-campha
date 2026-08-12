'use strict';

/**
 * M3 orchestrator — Rain-based Flood Risk Index.
 *
 * Stages:
 *   1. loadAoi
 *   2. build rainfall stack (IMERG event + CHIRPS antecedent, or MANUAL scalars)
 *   3. load terrain / HAND / DW context (weights + inversion inputs)
 *   4. compute risk score (weighted-factor combination)
 *   5. classify into 3-band + binary mask
 *   6. cheap metrics (high-risk area, sample rainfall percentiles)
 *   7. assemble artifacts + metadata (PROBABILITY_CALIBRATED=false stamped)
 *
 * @source docs/Flood_D_final.js (`runRainRiskIndex`:3541)
 * @rule   architecture doc §16 — never label output as "probability"
 */

const defaultsAndConfig = require('../config/defaults');
const versions = require('../config/versions');
const { assertValidMode } = require('../config/product-vs-calibration');

const geometryHelpers = require('../common/geometry');
const terrainHelpers = require('../common/terrain');
const handHelpers = require('../common/hand');
const waterMaskHelpers = require('../common/water-masks');
const dynamicWorldHelpers = require('../common/dynamic-world');
const reducerHelpers = require('../common/reducers');

const rainfallHelpers = require('./rainfall-source');
const riskModelHelpers = require('./risk-model');
const thresholdHelpers = require('./threshold');
const resultHelpers = require('./result');

function defaultDeps() {
    return {
        geometry: geometryHelpers,
        terrain: terrainHelpers,
        hand: handHelpers,
        waterMasks: waterMaskHelpers,
        dynamicWorld: dynamicWorldHelpers,
        reducers: reducerHelpers,
        rainfall: rainfallHelpers,
        riskModel: riskModelHelpers,
        threshold: thresholdHelpers,
        result: resultHelpers,
    };
}

async function runRainRisk({
    ee,
    geeAdapter,
    runConfig,
    runMode = 'product',
    authoritativeGeoJson = null,
    deps = defaultDeps(),
} = {}) {
    if (!ee) {throw new Error('rain.index.runRainRisk requires the ee module');}
    if (!geeAdapter?.evaluate) {
        throw new Error('rain.index.runRainRisk requires geeAdapter.evaluate');
    }
    if (!runConfig) {throw new Error('rain.index.runRainRisk requires runConfig');}
    assertValidMode(runMode);

    const config = { ...defaultsAndConfig.RAIN_RISK_DEFAULTS, ...runConfig, mode: runMode };

    // Stage 1: AOI
    const { geometry: aoi, source: aoiSource } = deps.geometry.loadAoi(ee, {
        authoritativeGeoJson,
    });

    // Stage 2: rainfall stack (source-dependent)
    const rainStack =
        config.source === 'IMERG'
            ? deps.rainfall.buildRainfallStack(ee, {
                  eventTime: config.eventTime,
                  aoi,
              })
            : deps.rainfall.buildManualRainfallStack(ee, config.rainfall || {});

    // Stage 3: risk-model inputs (terrain / HAND / hydro / built)
    const terrainStack = deps.terrain.buildTerrainStack(ee);
    const handStack = deps.hand.buildHandStack(ee, terrainStack.slope);
    // Hydro distance — approximate via distance from JRC permanent-water pixels.
    const waterStack = deps.waterMasks.buildWaterStack(ee, {
        elevationImage: terrainStack.elevation,
    });
    const hydroDistance = waterStack.permanent
        .fastDistanceTransform(30)
        .sqrt()
        .rename('hydro_distance_m');

    const dwCache = deps.dynamicWorld.createRunCache();
    // Use a ~1-month window ending at eventTime (fallback to current when MANUAL).
    const dwEnd = config.eventTime ? String(config.eventTime).slice(0, 10) : '2025-01-01';
    const dwStart = _monthsBefore(dwEnd, 12);
    const dw = dwCache.get(ee, { startDate: dwStart, endDate: dwEnd, aoi });

    // Stage 4: risk score
    const riskScore = deps.riskModel.combineFactors(ee, {
        rain24h: rainStack.rain24h,
        handImage: handStack.hand,
        twiImage: handStack.twi,
        slopeDeg: terrainStack.slope,
        hydroDistance,
        builtDensity: dw.builtDensity,
    });

    // Stage 5: classify + binary mask
    const riskMask = deps.threshold.thresholdMask(ee, riskScore, config.threshold);
    const riskClass = deps.threshold.classifyRiskBand(ee, riskScore, config.threshold);

    // Stage 6: cheap metrics
    let highRiskAreaHa = null;
    try {
        highRiskAreaHa = await geeAdapter.evaluate(
            deps.reducers.areaHaSafe(ee, { maskImage: riskMask, geometry: aoi }),
        );
    } catch {
        /* non-fatal */
    }
    // Sample rainfall totals — mean over AOI. When MANUAL source, the "image"
    // is a constant so this returns the same scalar.
    const _meanScalar = async (img) => {
        if (!img) {return null;}
        try {
            const pct = deps.reducers.percentiles(ee, {
                image: img,
                geometry: aoi,
                percentileList: [50],
            });
            const evaluated = (await geeAdapter.evaluate(pct)) || {};
            const key = Object.keys(evaluated).find((k) => k.endsWith('_p50'));
            return key && Number.isFinite(evaluated[key]) ? evaluated[key] : null;
        } catch {
            return null;
        }
    };
    const rainMm3h = await _meanScalar(rainStack.rain3h);
    const rainMm24h = await _meanScalar(rainStack.rain24h);
    const rainMm7d = await _meanScalar(rainStack.rain7d);

    // Stage 7: assemble
    const catalog = deps.result.selectM3Artifacts({ runMode });
    const artifacts = {
        rain_risk_score: riskScore,
        rain_risk_class: riskClass,
    };
    const metadata = deps.result.buildM3ResultMetadata({
        source: config.source,
        eventTime: config.eventTime || null,
        threshold: config.threshold,
        weights: deps.riskModel.RISK_WEIGHTS,
        rainMm3h,
        rainMm24h,
        rainMm7d,
        highRiskAreaHa,
        warnings: [
            ...(terrainStack.isFallback ? ['TERRAIN_FELL_BACK_TO_DSM'] : []),
            ...(terrainStack.nonCommercial ? ['NON_COMMERCIAL_DTM_FABDEM'] : []),
        ],
    });
    metadata.pipelineVersion = versions.pipelineVersionFor('rain');
    metadata.configVersion = versions.CONFIG_VERSION;
    metadata.aoiSource = aoiSource;

    return { artifacts, catalog, metadata, diagnostics: null };
}

function _monthsBefore(isoDate, months) {
    const d = new Date(isoDate);
    if (Number.isNaN(d.valueOf())) {return isoDate;}
    d.setUTCMonth(d.getUTCMonth() - months);
    return d.toISOString().slice(0, 10);
}

module.exports = { runRainRisk, defaultDeps };
