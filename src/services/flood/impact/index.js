'use strict';

/**
 * M4 orchestrator — flood impact statistics.
 *
 * Takes the source flood mask (from M1 / M2 / M3) and computes the metrics
 * bundle the client renders as cards + charts. Per architecture doc §54,
 * this module does NOT publish rasters by default — the metrics JSON is
 * the primary output.
 *
 * Stages:
 *   1. loadAoi
 *   2. load Dynamic World composite (built mask + composite year)
 *   3. build population + cropland + built + landcover masks
 *   4. reduce every metric via geeAdapter.evaluate
 *   5. assemble metadata (with data-source stamps per §55)
 *
 * @source docs/Flood_D_final.js (`runImpactAnalysis`:4078, `createLandcoverImpactChart`:4282)
 * @rule   architecture doc §54 no raster publication by default
 * @rule   §55 data-source metadata (year, version, provider) always included
 */

const versions = require('../config/versions');
const { assertValidMode } = require('../config/product-vs-calibration');

const geometryHelpers = require('../common/geometry');
const dynamicWorldHelpers = require('../common/dynamic-world');
const reducerHelpers = require('../common/reducers');

const populationHelpers = require('./population');
const croplandHelpers = require('./cropland');
const builtUpHelpers = require('./built-up');
const landcoverHelpers = require('./landcover');
const resultHelpers = require('./result');

function defaultDeps() {
    return {
        geometry: geometryHelpers,
        dynamicWorld: dynamicWorldHelpers,
        reducers: reducerHelpers,
        population: populationHelpers,
        cropland: croplandHelpers,
        builtUp: builtUpHelpers,
        landcover: landcoverHelpers,
        result: resultHelpers,
    };
}

async function runImpactAnalysis({
    ee,
    geeAdapter,
    runConfig,
    runMode = 'product',
    authoritativeGeoJson = null,
    // Source flood mask (from M1/M2/M3). Callers pass the ee.Image directly;
    // no auto-lookup here — decoupling avoids implicit cross-module state.
    sourceFloodMask,
    // What produced `sourceFloodMask` — stamped on metadata for provenance.
    sourceType,
    sourceRunId = null,
    // Dynamic World composite year to use for the built mask + provenance.
    dwCompositeYear = null,
    deps = defaultDeps(),
} = {}) {
    if (!ee) {throw new Error('impact.index.runImpactAnalysis requires the ee module');}
    if (!geeAdapter?.evaluate) {
        throw new Error('impact.index.runImpactAnalysis requires geeAdapter.evaluate');
    }
    if (!runConfig) {throw new Error('impact.index.runImpactAnalysis requires runConfig');}
    if (!sourceFloodMask) {
        throw new Error('impact.index.runImpactAnalysis requires sourceFloodMask');
    }
    if (!sourceType || !['M1', 'M2', 'M3'].includes(sourceType)) {
        throw new Error("impact.index.runImpactAnalysis requires sourceType in {'M1','M2','M3'}");
    }
    assertValidMode(runMode);

    // Stage 1: AOI
    const { geometry: aoi, source: aoiSource } = deps.geometry.loadAoi(ee, {
        authoritativeGeoJson,
    });

    // Stage 2: Dynamic World context (for built mask + composite year)
    const dwCache = deps.dynamicWorld.createRunCache();
    const yearForDw = Number.isFinite(dwCompositeYear)
        ? dwCompositeYear
        : new Date().getUTCFullYear();
    const dw = dwCache.get(ee, {
        startDate: `${yearForDw}-01-01`,
        endDate: `${yearForDw + 1}-01-01`,
        aoi,
    });

    // Stage 3: build per-category masks
    const affectedPopulationImg = deps.population.affectedPopulationImage(ee, {
        floodMask: sourceFloodMask,
    });
    const affectedCropMask = deps.cropland.affectedCroplandMask(ee, {
        floodMask: sourceFloodMask,
    });
    const affectedBuiltMask = deps.builtUp.affectedBuiltMask(ee, {
        floodMask: sourceFloodMask,
        builtMask: dw.built,
    });
    const landcoverImage = deps.landcover.loadLandcoverImage(ee);

    // Stage 4: reduce
    let floodAreaHa = null;
    let affectedPopulation = null;
    let affectedCroplandHa = null;
    let affectedBuiltHa = null;
    let landcoverBreakdown = [];
    try {
        floodAreaHa = await geeAdapter.evaluate(
            deps.reducers.areaHaSafe(ee, { maskImage: sourceFloodMask, geometry: aoi }),
        );
    } catch {
        /* non-fatal */
    }
    try {
        // Population is a value (not a mask), so we need a straight sum.
        // Reuse areaHaSafe by masking a per-pixel-1 image with `> 0` then sum;
        // simpler: reduce directly with Reducer.sum on the ee.Image.
        const popStats = affectedPopulationImg.reduceRegion({
            reducer: ee.Reducer.sum(),
            geometry: aoi,
            scale: 100, // GHSL native
            maxPixels: 1e10,
            bestEffort: true,
        });
        const popEvaluated = (await geeAdapter.evaluate(popStats)) || {};
        const key = Object.keys(popEvaluated).find((k) => k.includes('affected_population'));
        affectedPopulation = key && Number.isFinite(popEvaluated[key]) ? popEvaluated[key] : null;
    } catch {
        /* non-fatal */
    }
    try {
        affectedCroplandHa = await geeAdapter.evaluate(
            deps.reducers.areaHaSafe(ee, { maskImage: affectedCropMask, geometry: aoi }),
        );
    } catch {
        /* non-fatal */
    }
    try {
        affectedBuiltHa = await geeAdapter.evaluate(
            deps.reducers.areaHaSafe(ee, { maskImage: affectedBuiltMask, geometry: aoi }),
        );
    } catch {
        /* non-fatal */
    }
    try {
        const grouped = deps.reducers.areaHaByClass(ee, {
            classifiedImage: landcoverImage,
            maskImage: sourceFloodMask,
            geometry: aoi,
        });
        landcoverBreakdown = deps.landcover.summariseLandcoverGroups(
            (await geeAdapter.evaluate(grouped)) || {},
        );
    } catch {
        /* non-fatal */
    }

    // Stage 5: assemble
    const catalog = deps.result.selectM4Artifacts({ runMode });
    // Only expose QA masks — no PRODUCT artifact per §54.
    const artifacts = {
        affected_population: affectedPopulationImg,
        affected_cropland: affectedCropMask,
        affected_built: affectedBuiltMask,
    };
    const metadata = deps.result.buildM4ResultMetadata({
        sourceType,
        sourceRunId,
        floodAreaHa,
        affectedPopulation,
        affectedCroplandHa,
        affectedBuiltHa,
        landcoverBreakdown,
        dwCompositeYear: yearForDw,
        warnings: [],
    });
    metadata.pipelineVersion = versions.pipelineVersionFor('impact');
    metadata.configVersion = versions.CONFIG_VERSION;
    metadata.aoiSource = aoiSource;

    return { artifacts, catalog, metadata, diagnostics: null };
}

module.exports = { runImpactAnalysis, defaultDeps };
