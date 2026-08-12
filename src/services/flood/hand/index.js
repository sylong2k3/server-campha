'use strict';

/**
 * M2 orchestrator — HAND scenario mask + depth.
 *
 * Much simpler than M1: no SAR ingest, no orbit selection, no per-image
 * classifier — MERIT/Hydro HAND alone drives the mask.
 *
 * Stages:
 *   1. loadAoi
 *   2. build terrain + HAND stacks (from services/flood/common)
 *   3. compute scenario mask (scenario.scenarioMask)
 *   4. compute depth (depth.depthImage)
 *   5. small-object filter (services/flood/event/morphology — reused)
 *   6. compute area + mean/max depth via geeAdapter.evaluate
 *   7. assemble artifacts + metadata
 *
 * @source docs/Flood_D_final.js (`runHANDScenario`:3403–3540)
 * @rule   architecture doc §16 — M2 is a SCENARIO, never observed
 */

const defaultsAndConfig = require('../config/defaults');
const versions = require('../config/versions');
const { assertValidMode } = require('../config/product-vs-calibration');

const geometryHelpers = require('../common/geometry');
const terrainHelpers = require('../common/terrain');
const handStackHelpers = require('../common/hand');
const reducerHelpers = require('../common/reducers');
const morphologyHelpers = require('../event/morphology');

const { scenarioMask } = require('./scenario');
const { depthImage } = require('./depth');
const resultHelpers = require('./result');

function defaultDeps() {
    return {
        geometry: geometryHelpers,
        terrain: terrainHelpers,
        hand: handStackHelpers,
        reducers: reducerHelpers,
        morphology: morphologyHelpers,
        scenario: { scenarioMask },
        depth: { depthImage },
        result: resultHelpers,
    };
}

async function runHandScenario({
    ee,
    geeAdapter,
    runConfig,
    runMode = 'product',
    authoritativeGeoJson = null,
    deps = defaultDeps(),
} = {}) {
    if (!ee) {throw new Error('hand.index.runHandScenario requires the ee module');}
    if (!geeAdapter?.evaluate) {
        throw new Error('hand.index.runHandScenario requires geeAdapter.evaluate');
    }
    if (!runConfig) {throw new Error('hand.index.runHandScenario requires runConfig');}
    assertValidMode(runMode);

    const config = { ...defaultsAndConfig.HAND_DEFAULTS, ...runConfig, mode: runMode };

    // Stage 1: AOI
    const { geometry: aoi, source: aoiSource } = deps.geometry.loadAoi(ee, {
        authoritativeGeoJson,
    });

    // Stage 2: terrain + HAND
    const terrainStack = deps.terrain.buildTerrainStack(ee);
    const handStack = deps.hand.buildHandStack(ee, terrainStack.slope);

    // Stage 3: scenario mask
    const scenario = deps.scenario.scenarioMask(ee, {
        handImage: handStack.hand,
        levelM: config.levelM,
        slopeDeg: terrainStack.slope,
        maximumSlope: config.maximumSlope,
    });

    // Stage 4: depth
    const depth = deps.depth.depthImage(ee, {
        handImage: handStack.hand,
        levelM: config.levelM,
        scenarioMask: scenario,
    });

    // Stage 5: small-object filter — reuse M1's morphology helper.
    // Minimum meaningful cluster ≈ 8 pixels per floodTrend:3458.
    const scenarioClean = deps.morphology.removeSmallFloodObjects(ee, {
        floodMask: scenario,
        minAreaM2: 8 * 900, // 8 pixels × 900 m²/pixel at 30 m resolution
    });

    // Stage 6: cheap metrics
    let scenarioAreaHa = null;
    let meanDepthM = null;
    let maxDepthM = null;
    try {
        scenarioAreaHa = await geeAdapter.evaluate(
            deps.reducers.areaHaSafe(ee, { maskImage: scenarioClean, geometry: aoi }),
        );
    } catch {
        /* non-fatal */
    }
    if (typeof deps.reducers.percentiles === 'function') {
        try {
            const percentileDict = deps.reducers.percentiles(ee, {
                image: depth,
                geometry: aoi,
                percentileList: [50, 99],
            });
            const evaluated = (await geeAdapter.evaluate(percentileDict)) || {};
            meanDepthM = Number.isFinite(evaluated.hand_depth_p50) ? evaluated.hand_depth_p50 : null;
            maxDepthM = Number.isFinite(evaluated.hand_depth_p99) ? evaluated.hand_depth_p99 : null;
        } catch {
            /* non-fatal */
        }
    }

    // Stage 7: assemble
    const catalog = deps.result.selectM2Artifacts({ runMode });
    const artifacts = {
        hand_scenario: scenarioClean,
        hand_depth: depth,
    };
    const metadata = deps.result.buildM2ResultMetadata({
        levelM: config.levelM,
        maximumSlope: config.maximumSlope,
        scenarioAreaHa,
        meanDepthM,
        maxDepthM,
        warnings: [
            ...(terrainStack.isFallback ? ['TERRAIN_FELL_BACK_TO_DSM'] : []),
            ...(terrainStack.nonCommercial ? ['NON_COMMERCIAL_DTM_FABDEM'] : []),
        ],
    });
    metadata.pipelineVersion = versions.pipelineVersionFor('hand');
    metadata.configVersion = versions.CONFIG_VERSION;
    metadata.aoiSource = aoiSource;

    return { artifacts, catalog, metadata, diagnostics: null };
}

module.exports = { runHandScenario, defaultDeps };
