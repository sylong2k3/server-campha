'use strict';

/**
 * M1 orchestrator — Sentinel-1 event flood detection.
 *
 * Stitches together every helper in services/flood/common + services/flood/event
 * to build the M1 result stack from a validated run config.
 *
 * The reference project's `processS1FloodV3` is ~895 lines in one function.
 * Here we split it into named stages so each stage is independently swappable
 * for tests and future scientific tuning:
 *
 *   Stage 1  loadAoi
 *   Stage 2  fetchPreAndPostCollections
 *   Stage 3  chooseOrbit
 *   Stage 4  buildBaseline
 *   Stage 5  computeThreshold (fixed | otsu | median_sigma)
 *   Stage 6  loadTerrainStack + loadHandStack + loadWaterStack + loadDynamicWorldCtx
 *   Stage 7  classifyPerImage → reduceVotes
 *   Stage 8  applyTerrainMasks (slope + HAND + permanent-water + mining exclusion)
 *   Stage 9  morphology (removeSmall + openClose)
 *   Stage 10 splitByTidal
 *   Stage 11 assemble result artifacts + metadata
 *
 * Every ee-touching helper is passed via a `deps` object; production wires
 * the real modules; tests substitute fakes.
 *
 * @source docs/Flood_D_final.js (`runS1Flood`:2275, `processS1FloodV3`:2506–3401)
 */

const defaultsAndConfig = require('../config/defaults');
const versions = require('../config/versions');
const { assertValidMode, shouldEnableDiagnostics } = require('../config/product-vs-calibration');

const geometryHelpers = require('../common/geometry');
const sentinel1Helpers = require('../common/sentinel1');
const terrainHelpers = require('../common/terrain');
const handHelpers = require('../common/hand');
const waterMaskHelpers = require('../common/water-masks');
const dynamicWorldHelpers = require('../common/dynamic-world');
const miningMaskHelpers = require('../common/mining-mask');
const otsuHelpers = require('../common/otsu');
const reducerHelpers = require('../common/reducers');

const baselineHelpers = require('./baseline');
const orbitHelpers = require('./orbit-selection');
const classifierHelpers = require('./classifier');
const morphologyHelpers = require('./morphology');
const tidalHelpers = require('./tidal-split');
const resultHelpers = require('./result');

/**
 * Aggregate default helper wiring. Production callers pass an ee module and
 * a geeAdapter (with `evaluate`); tests can override any helper individually.
 */
function defaultDeps() {
    return {
        geometry: geometryHelpers,
        sentinel1: sentinel1Helpers,
        terrain: terrainHelpers,
        hand: handHelpers,
        waterMasks: waterMaskHelpers,
        dynamicWorld: dynamicWorldHelpers,
        miningMask: miningMaskHelpers,
        otsu: otsuHelpers,
        reducers: reducerHelpers,
        baseline: baselineHelpers,
        orbit: orbitHelpers,
        classifier: classifierHelpers,
        morphology: morphologyHelpers,
        tidal: tidalHelpers,
        result: resultHelpers,
    };
}

/**
 * Threshold selector — dispatches to fixed / otsu / median_sigma.
 * `fixed` returns `params.vhFallbackDb` verbatim (the safe default in
 * Flood_D:172 that avoids Otsu's unimodal-histogram bias documented in the
 * reference log).
 */
async function _resolveThreshold(
    ee,
    geeAdapter,
    deps,
    { thresholdMode, postCollection, baselineVH, aoi, params },
) {
    if (thresholdMode === 'fixed') {
        return { threshold: params.vhFallbackDb, mode: 'fixed', usedFallback: false };
    }
    // Adaptive modes threshold the baseline-minus-current dB decrease, not
    // absolute post-event VH.
    const vhDecrease = baselineVH
        .subtract(postCollection.median().select('VH'))
        .rename('VH_decrease');
    if (thresholdMode === 'otsu') {
        const out = deps.otsu.otsuThresholdOnBand(ee, {
            image: vhDecrease,
            band: 'VH_decrease',
            geometry: aoi,
            minDb: params.otsuMinDb,
            maxDb: params.otsuMaxDb,
            fallback: params.vhFallbackDb,
        });
        // Evaluate to a JS number so the calling classifier gets a plain scalar.
        const [threshold, usedFallback] = await Promise.all([
            geeAdapter.evaluate(out.threshold),
            geeAdapter.evaluate(out.usedFallback),
        ]);
        return { threshold, mode: 'otsu', usedFallback: Boolean(usedFallback) };
    }
    if (thresholdMode === 'median_sigma') {
        const out = deps.otsu.computeMedianSigmaThreshold(ee, {
            image: vhDecrease,
            band: 'VH_decrease',
            geometry: aoi,
            k: params.medianSigmaK,
            minDb: params.otsuMinDb,
            maxDb: params.otsuMaxDb,
            fallback: params.vhFallbackDb,
        });
        const [threshold, usedFallback] = await Promise.all([
            geeAdapter.evaluate(out.threshold),
            geeAdapter.evaluate(out.usedFallback),
        ]);
        return { threshold, mode: 'median_sigma', usedFallback: Boolean(usedFallback) };
    }
    throw new Error(`Unknown thresholdMode: ${thresholdMode}`);
}

/**
 * Main M1 entry point.
 *
 * @param {object} opts
 * @param {object} opts.ee
 * @param {object} opts.geeAdapter                  — services/gee-earth-engine.adapter
 * @param {object} opts.runConfig                   — validated per config/schema.validateRunConfig('event', ...)
 * @param {'product'|'calibration'} [opts.runMode='product']
 * @param {object} [opts.authoritativeGeoJson]     — override for the GAUL AOI (§82)
 * @param {object} [opts.deps]                      — inject helper modules (test DI)
 * @returns {Promise<{
 *   artifacts: object,   // { code: ee.Image }
 *   catalog: Array,      // resultHelpers.selectM1Artifacts output
 *   metadata: object,    // resultHelpers.buildM1ResultMetadata output
 *   diagnostics: object|null
 * }>}
 */
async function runSentinel1Flood({
    ee,
    geeAdapter,
    runConfig,
    runMode = 'product',
    authoritativeGeoJson = null,
    deps = defaultDeps(),
} = {}) {
    if (!ee) {
        throw new Error('event.index.runSentinel1Flood requires the ee module');
    }
    if (!geeAdapter?.evaluate) {
        throw new Error('event.index.runSentinel1Flood requires geeAdapter.evaluate');
    }
    if (!runConfig) {
        throw new Error('event.index.runSentinel1Flood requires runConfig');
    }
    assertValidMode(runMode);

    const config = { ...defaultsAndConfig.S1_DEFAULTS, ...runConfig, mode: runMode };
    const thresholds = defaultsAndConfig.S1_THRESHOLDS;

    // ── Stage 1: AOI ─────────────────────────────────────────────────
    const {
        fc,
        geometry: aoi,
        source: aoiSource,
    } = deps.geometry.loadAoi(ee, {
        authoritativeGeoJson,
    });
    void fc;

    // ── Stage 2: pre + post collections ──────────────────────────────
    const preCollection = deps.sentinel1.getS1Collection(ee, {
        start: config.preStart,
        end: config.preEnd,
        aoi,
        pass: config.orbitPass,
    });
    const postCollection = deps.sentinel1.getS1Collection(ee, {
        start: config.postStart,
        end: config.postEnd,
        aoi,
        pass: config.orbitPass,
    });

    // ── Stage 3: orbit selection ─────────────────────────────────────
    const orbit = await deps.orbit.chooseBestS1Orbit(ee, {
        preCollection,
        postCollection,
        geeAdapter,
    });
    if (!orbit) {
        return {
            artifacts: {},
            catalog: [],
            metadata: deps.result.buildM1ResultMetadata({
                warnings: ['NO_SAR_ORBIT_MATCH'],
            }),
            diagnostics: null,
        };
    }
    const preFiltered = deps.sentinel1.getS1Collection(ee, {
        start: config.preStart,
        end: config.preEnd,
        aoi,
        pass: orbit.orbitPass,
        relativeOrbit: orbit.relativeOrbit,
    });
    const postFiltered = deps.sentinel1.getS1Collection(ee, {
        start: config.postStart,
        end: config.postEnd,
        aoi,
        pass: orbit.orbitPass,
        relativeOrbit: orbit.relativeOrbit,
    });

    // ── Stage 4: baseline + scale ────────────────────────────────────
    const baseline = deps.baseline.createS1Baseline(ee, preFiltered);
    const baselineScale = deps.baseline.createS1BaselineScale(ee, preFiltered, baseline);

    // ── Stage 5: decision threshold ──────────────────────────────────
    const {
        threshold: decisionThreshold,
        mode: thresholdModeUsed,
        usedFallback,
    } = await _resolveThreshold(ee, geeAdapter, deps, {
        thresholdMode: config.thresholdMode,
        postCollection: postFiltered,
        baselineVH: baseline.select('VH'),
        aoi,
        thresholds,
        params: config,
    });

    // ── Stage 6: terrain / HAND / water / DW context ─────────────────
    const terrainStack = deps.terrain.buildTerrainStack(ee);
    const handStack = deps.hand.buildHandStack(ee, terrainStack.slope);
    const waterStack = deps.waterMasks.buildWaterStack(ee, {
        elevationImage: terrainStack.elevation,
    });
    const dwCache = deps.dynamicWorld.createRunCache();
    const dw = dwCache.get(ee, {
        startDate: config.preStart,
        endDate: config.postEnd,
        aoi,
    });
    const miningStack = deps.miningMask.createMiningMask(ee, {
        slopeDeg: terrainStack.slope,
        handImage: handStack.hand,
        elevationImage: terrainStack.elevation,
    });

    // ── Stage 7: classify each post image + reduce votes ─────────────
    const preBaselineVV = baseline.select('VV');
    const preBaselineVH = baseline.select('VH');
    const shallowContext = {
        enableShallowFlood: config.enableShallowFlood,
        shallowExtraDb: config.shallowExtraDecreaseDb,
        shallowPostVHDb: config.shallowPostVHDb,
    };
    const urbanContext = config.enableUrbanDoubleBounce
        ? {
              enableUrban: true,
              builtDensity: dw.builtDensity,
              slopeDeg: terrainStack.slope,
              handImage: handStack.hand,
              thresholds: {
                  urbanVVIncreaseDb: config.urbanVVIncreaseDb,
                  urbanVVZ: config.urbanVVZ,
                  urbanVHDecreaseToleranceDb: config.urbanVHDecreaseToleranceDb,
                  urbanBuiltDensity: config.urbanBuiltDensity,
                  urbanMaximumSlope: config.urbanMaximumSlope,
                  urbanMaximumHAND: config.urbanMaximumHAND,
              },
          }
        : null;
    const voteCollection = postFiltered.map((img) =>
        deps.classifier.classifySinglePostImage(ee, {
            preBaselineVV,
            preBaselineVH,
            postVV: img.select('VV'),
            postVH: img.select('VH'),
            vhScale: baselineScale.select('VH_scale'),
            vvScale: baselineScale.select('VV_scale'),
            decisionThreshold,
            thresholds,
            shallowContext,
            urbanContext,
            minimumDarkSupportVotes: config.minimumDarkSupportVotes,
        }),
    );
    const voteReducerParams = deps.classifier.applyEventModeOverride({
        eventMode: config.eventMode,
        minimumVotes: config.minimumVotes,
        minimumObservations: config.minimumObservations,
        minimumVoteFraction: config.minimumVoteFraction,
    });
    const rawFloodMask = deps.classifier.reduceVotesToMask(ee, {
        voteCollection,
        ...voteReducerParams,
    });
    const rawDarkMask = deps.classifier.reduceVotesToMask(ee, {
        voteCollection,
        band: 'dark_flood_vote',
        ...voteReducerParams,
    });
    const rawShallowMask = config.enableShallowFlood
        ? deps.classifier.reduceVotesToMask(ee, {
              voteCollection,
              band: 'shallow_vote',
              ...voteReducerParams,
          })
        : null;
    const rawUrbanMask = config.enableUrbanDoubleBounce
        ? deps.classifier.reduceVotesToMask(ee, {
              voteCollection,
              band: 'urban_vote',
              ...voteReducerParams,
          })
        : null;

    // ── Stage 8: terrain + permanent-water + mining exclusion ────────
    const terrainMask = terrainStack.slope
        .lte(config.hardMaximumSlope)
        .and(handStack.hand.lte(config.hardMaximumHAND));
    const eligibilityMask = terrainMask.and(waterStack.permanent.not());
    const floodPreMorph = rawFloodMask
        .and(eligibilityMask)
        .and(miningStack.mask.not())
        .rename('flood_mask');

    // ── Stage 9: morphology ──────────────────────────────────────────
    const trimmed = deps.morphology.removeSmallFloodObjects(ee, {
        floodMask: floodPreMorph,
        minAreaM2: config.minimumAreaM2,
    });
    const smoothed = deps.morphology.openClose(ee, { mask: trimmed });
    const finalizeBranch = (branchMask) => {
        if (!branchMask) {
            return null;
        }
        const eligible = branchMask.and(eligibilityMask).and(miningStack.mask.not());
        const branchTrimmed = deps.morphology.removeSmallFloodObjects(ee, {
            floodMask: eligible,
            minAreaM2: config.minimumAreaM2,
        });
        return deps.morphology.openClose(ee, { mask: branchTrimmed });
    };
    const darkFlood = finalizeBranch(rawDarkMask);
    const shallowFlood = finalizeBranch(rawShallowMask);
    const urbanFlood = finalizeBranch(rawUrbanMask);

    // ── Stage 10: tidal split ────────────────────────────────────────
    const { floodNonTidal, tidalFloodCandidate } = waterStack.tidalUncertainty
        ? deps.tidal.splitByTidal(ee, {
              floodMask: smoothed,
              tidalUncertainty: waterStack.tidalUncertainty,
          })
        : { floodNonTidal: smoothed, tidalFloodCandidate: null };

    // ── Stage 11: assemble artifacts + metadata ──────────────────────
    const catalog = deps.result.selectM1Artifacts({
        enableShallowFlood: config.enableShallowFlood,
        enableUrbanDoubleBounce: config.enableUrbanDoubleBounce,
        runMode,
    });
    const artifacts = {
        main_flood_non_tidal: floodNonTidal,
        open_water: darkFlood,
        tidal_candidate: tidalFloodCandidate,
        mining_candidate: miningStack.mask,
    };
    if (config.enableShallowFlood) {
        artifacts.shallow_flood = shallowFlood;
    }
    if (config.enableUrbanDoubleBounce) {
        artifacts.urban_double_bounce = urbanFlood;
    }
    // Drop nulls.
    for (const k of Object.keys(artifacts)) {
        if (!artifacts[k]) {
            delete artifacts[k];
        }
    }

    // Optional area metrics — evaluate a small, cheap set (main only) for the
    // metadata JSON. Full statistics belong in M4.
    let mainAreaHa = null;
    try {
        const mainAreaImg = deps.reducers.areaHaSafe(ee, {
            maskImage: floodNonTidal,
            geometry: aoi,
        });
        mainAreaHa = await geeAdapter.evaluate(mainAreaImg);
    } catch {
        // Non-fatal: metrics failure shouldn't fail the whole run.
    }

    const metadata = deps.result.buildM1ResultMetadata({
        orbitKey: orbit.orbitKey,
        orbitPass: orbit.orbitPass,
        relativeOrbit: orbit.relativeOrbit,
        lastM1Threshold: decisionThreshold,
        preSceneCount: orbit.preCount,
        postSceneCount: orbit.postCount,
        warnings: [
            ...(usedFallback ? ['THRESHOLD_FALLBACK_USED'] : []),
            ...(terrainStack.isFallback ? ['TERRAIN_FELL_BACK_TO_DSM'] : []),
            ...(terrainStack.nonCommercial ? ['NON_COMMERCIAL_DTM_FABDEM'] : []),
        ],
    });
    metadata.thresholdMode = thresholdModeUsed;
    metadata.pipelineVersion = versions.pipelineVersionFor('event');
    metadata.configVersion = versions.CONFIG_VERSION;
    metadata.aoiSource = aoiSource;
    metadata.mainAreaHa = mainAreaHa;

    return {
        artifacts,
        catalog,
        metadata,
        diagnostics: shouldEnableDiagnostics({ mode: runMode })
            ? { dwCacheSize: dwCache.size() }
            : null,
    };
}

module.exports = {
    runSentinel1Flood,
    // `runAnalysis` is the alias the child worker calls per kind (see
    // workers/geeAnalysis.child.js KIND_TO_MODULE). Both names accept the
    // same signature — payload is the first arg, so the child can `.call(...,
    // payload)`; every other call site continues to use the named function.
    runAnalysis: (payload) => runSentinel1Flood(payload),
    defaultDeps,
    _resolveThreshold, // exported for unit tests
};
