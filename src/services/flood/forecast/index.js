'use strict';

/**
 * M6 orchestrator — Kịch bản Lượng mưa + Thuỷ triều → Lớp phủ dự báo.
 *
 * Mô hình tính toán:
 *   h_rain_m  = rainfallCoefficient × (rainfall_24h / 100) ^ 0.6
 *   h_eff_m   = max(0, h_rain_m + tideLevelM)
 *   mask ngập = HAND ≤ h_eff_m  AND slope ≤ maximumSlope
 *
 * Tái sử dụng các helper địa hình từ M2/M3 (geometry, terrain, hand, reducers,
 * morphology). Không cần GEE ImageCollection — toàn bộ đầu vào là scalar,
 * chạy nhanh hơn đáng kể so với M1/M5.
 *
 * Stages:
 *   1. loadAoi
 *   2. buildTerrainStack + buildHandStack
 *   3. computeEffectiveLevel (Node — không cần ee)
 *   4. forecastMask  (HAND ≤ h_eff AND slope ≤ max_slope AND HAND ≤ maxHAND)
 *   5. forecastDepth (h_eff − HAND, clipped ≥ 0)
 *   6. forecastClass (3-tier: 1 thấp / 2 trung bình / 3 cao)
 *   7. small-object filter (reuse M2 morphology)
 *   8. metrics (area, mean/max depth) via geeAdapter.evaluate
 *   9. assemble artifacts + metadata
 *
 * @module services/flood/forecast/index
 * @rule   architecture doc §15 (lock scientific defaults), §16 (no-probability label)
 * @rule   architecture doc §19 (product/calibration split)
 */

const defaultsAndConfig = require('../config/defaults');
const versions = require('../config/versions');
const { assertValidMode } = require('../config/product-vs-calibration');

const geometryHelpers = require('../common/geometry');
const terrainHelpers = require('../common/terrain');
const handStackHelpers = require('../common/hand');
const reducerHelpers = require('../common/reducers');
const morphologyHelpers = require('../event/morphology');

const tideHelpers = require('./tide');
const resultHelpers = require('./result');

// ── 3-class thresholds ────────────────────────────────────────────────────────
// Phân lớp theo khoảng cách HAND đến h_eff:
//   Cao    — HAND ≤ h_eff  (ngập chắc chắn tại mực hiệu dụng)
//   Trung  — HAND ≤ h_eff × MEDIUM_FACTOR  (margin dưới ngưỡng cao)
//   Thấp   — HAND ≤ h_eff × LOW_FACTOR    (rủi ro thấp)
const CLASS_ID = Object.freeze({ low: 1, medium: 2, high: 3 });
const MEDIUM_FACTOR = 1.4; // HAND tới 140 % h_eff = trung bình
const LOW_FACTOR = 2.0;    // HAND tới 200 % h_eff = thấp

/**
 * Build the classified risk band based on HAND margin above h_eff.
 * @param {object} ee
 * @param {object} handImage   — HAND image (m)
 * @param {number} effectiveM  — h_eff scalar (m)
 * @returns {object} ee.Image with band 'forecast_flood_class' (1/2/3)
 */
function _classifyBand(ee, handImage, effectiveM) {
    return ee
        .Image(CLASS_ID.low)
        .where(handImage.lte(effectiveM * LOW_FACTOR), CLASS_ID.low)
        .where(handImage.lte(effectiveM * MEDIUM_FACTOR), CLASS_ID.medium)
        .where(handImage.lte(effectiveM), CLASS_ID.high)
        .rename('forecast_flood_class');
}

function defaultDeps() {
    return {
        geometry: geometryHelpers,
        terrain: terrainHelpers,
        hand: handStackHelpers,
        reducers: reducerHelpers,
        morphology: morphologyHelpers,
        tide: tideHelpers,
        result: resultHelpers,
    };
}

/**
 * Main M6 runner — called from run-executor.service.js via MODULE_RUNNERS.
 *
 * @param {object}  args
 * @param {object}  args.ee                    — Earth Engine client (from gge config)
 * @param {object}  args.geeAdapter            — { evaluate } adapter
 * @param {object}  args.runConfig             — validated M6 params snapshot
 * @param {string}  [args.runMode='product']   — 'product' | 'calibration'
 * @param {object}  [args.authoritativeGeoJson] — override AOI (null = use GAUL)
 * @param {object}  [args.deps]                — injectable deps for unit tests
 * @returns {Promise<{ artifacts, catalog, metadata, diagnostics }>}
 */
async function runForecast({
    ee,
    geeAdapter,
    runConfig,
    runMode = 'product',
    authoritativeGeoJson = null,
    deps = defaultDeps(),
} = {}) {
    if (!ee) {
        throw new Error('forecast.index.runForecast requires the ee module');
    }
    if (!geeAdapter?.evaluate) {
        throw new Error('forecast.index.runForecast requires geeAdapter.evaluate');
    }
    if (!runConfig) {
        throw new Error('forecast.index.runForecast requires runConfig');
    }
    assertValidMode(runMode);

    const config = {
        ...defaultsAndConfig.FORECAST_DEFAULTS,
        ...runConfig,
        mode: runMode,
    };

    // Stage 1: AOI
    const { geometry: aoi, source: aoiSource } = deps.geometry.loadAoi(ee, {
        authoritativeGeoJson,
    });

    // Stage 2: terrain + HAND stacks (reuse M2 helpers)
    const terrainStack = deps.terrain.buildTerrainStack(ee);
    const handStack = deps.hand.buildHandStack(ee, terrainStack.slope);

    // Stage 3: compute h_eff in Node (no ee call needed — pure scalar)
    const { rainLevelM, tideLevelM, effectiveLevelM } = deps.tide.computeEffectiveLevel(config);

    // Stage 4: forecast mask
    // Guard: if h_eff ≤ 0 (e.g. strong ebb tide + low rain) → empty mask.
    let forecastMask;
    if (effectiveLevelM <= 0) {
        // No flooding expected — return a zero image so downstream still works.
        forecastMask = ee.Image(0).rename('forecast_flood_mask');
    } else {
        forecastMask = handStack.hand
            .lte(effectiveLevelM)
            .and(terrainStack.slope.lte(config.maximumSlope))
            .and(handStack.hand.lte(config.maximumHAND))
            .rename('forecast_flood_mask');
    }

    // Stage 5: forecast depth = h_eff − HAND, clipped ≥ 0, only where masked
    // NOTE: depth uses forecastMask (raw) dùng để tính trước small-object filter;
    // sau đó được clip lại bởi forecastMaskClean khi export qua .clip(aoi) trong
    // run-executor. Stage 7 (clean mask) chạy trước để depth dùng đúng mask.

    // Stage 7 (moved up): small-object filter — minimum cluster ≈ 8 pixels at 30 m
    const forecastMaskClean = deps.morphology.removeSmallFloodObjects(ee, {
        floodMask: forecastMask,
        minAreaM2: 8 * 900, // 8 pixels × 900 m²/pixel at 30 m resolution
    });

    // Stage 5 (continued): depth uses the CLEAN mask so depth pixels are
    // spatially consistent with the published forecast_flood_mask.
    const forecastDepth =
        effectiveLevelM > 0
            ? ee
                  .Image(effectiveLevelM)
                  .subtract(handStack.hand)
                  .max(0)
                  .updateMask(forecastMaskClean)
                  .rename('forecast_flood_depth')
            : ee.Image(0).rename('forecast_flood_depth');

    // Stage 6: 3-class band uses clean mask too
    const forecastClass =
        effectiveLevelM > 0
            ? _classifyBand(ee, handStack.hand, effectiveLevelM).updateMask(forecastMaskClean)
            : ee.Image(CLASS_ID.low).rename('forecast_flood_class');

    // Stage 8: metrics — non-fatal
    let forecastAreaHa = null;
    let meanDepthM = null;
    let maxDepthM = null;

    try {
        forecastAreaHa = await geeAdapter.evaluate(
            deps.reducers.areaHaSafe(ee, { maskImage: forecastMaskClean, geometry: aoi }),
        );
    } catch {
        /* non-fatal */
    }

    if (typeof deps.reducers.percentiles === 'function' && effectiveLevelM > 0) {
        try {
            const pctDict = deps.reducers.percentiles(ee, {
                image: forecastDepth,
                geometry: aoi,
                percentileList: [50, 99],
            });
            const evaluated = (await geeAdapter.evaluate(pctDict)) || {};
            meanDepthM = Number.isFinite(evaluated.forecast_flood_depth_p50)
                ? evaluated.forecast_flood_depth_p50
                : null;
            maxDepthM = Number.isFinite(evaluated.forecast_flood_depth_p99)
                ? evaluated.forecast_flood_depth_p99
                : null;
        } catch {
            /* non-fatal */
        }
    }

    // Stage 9: assemble
    const catalog = deps.result.selectM6Artifacts({ runMode });
    const artifacts = {
        forecast_flood_mask: forecastMaskClean,
        forecast_flood_depth: forecastDepth,
        forecast_flood_class: forecastClass,
    };

    const metadata = deps.result.buildM6ResultMetadata({
        rainfall24hMm: config.rainfall?.amount24h ?? null,
        rainfall72hMm: config.rainfall?.amount72h ?? null,
        rainfall7dMm: config.rainfall?.amount7d ?? null,
        tideLevelM,
        rainLevelM,
        effectiveLevelM,
        rainfallCoefficient: config.rainfallCoefficient,
        maximumSlope: config.maximumSlope,
        maximumHAND: config.maximumHAND,
        forecastAreaHa,
        meanDepthM,
        maxDepthM,
        warnings: [
            ...(terrainStack.isFallback ? ['TERRAIN_FELL_BACK_TO_DSM'] : []),
            ...(terrainStack.nonCommercial ? ['NON_COMMERCIAL_DTM_FABDEM'] : []),
            ...(effectiveLevelM <= 0 ? ['EFFECTIVE_LEVEL_NON_POSITIVE_EMPTY_MASK'] : []),
        ],
    });

    metadata.pipelineVersion = versions.pipelineVersionFor('forecast');
    metadata.configVersion = versions.CONFIG_VERSION;
    metadata.aoiSource = aoiSource;

    return { artifacts, catalog, metadata, diagnostics: null };
}

module.exports = { runForecast, defaultDeps, CLASS_ID, MEDIUM_FACTOR, LOW_FACTOR };
