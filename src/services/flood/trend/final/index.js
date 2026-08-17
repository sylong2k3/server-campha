'use strict';

/**
 * FINAL M5 orchestrator: analysis-year-based seasonal flood trend analysis.
 *
 * Key differences from V1 (trend/index.js):
 *   - Input:  analysisYear (integer) → 4 seasons generated automatically.
 *   - Logic:  VH-only Otsu per-stratum, urban double-bounce, mine SAR heuristic.
 *   - Output: flood_extent, flood_frequency, new_flood, impact (pop/crop),
 *             land-change, drainage-risk. NO Sentinel-2 accuracy assessment.
 *
 * @ported-from final_code.js (entire script)
 * @pipeline TREND_FINAL
 */

const { TREND_FINAL_DEFAULTS } = require('../../config/defaults');
const versions = require('../../config/versions');
const { assertValidMode, shouldEnableDiagnostics } = require('../../config/product-vs-calibration');
const geometry = require('../../common/geometry');
const terrain = require('../../common/terrain');
const hand = require('../../common/hand');
const { permanentWater } = require('../../common/water-masks');
const { ASSETS } = require('../../common/datasets');
const sentinel1 = require('../../common/sentinel1');
const { chooseBestS1Orbit } = require('../../event/orbit-selection');

const seasons = require('./seasons');
const strata = require('./strata');
const periodAnalysis = require('./period-analysis');
const frequency = require('./frequency');
const landChange = require('./land-change');
const impact = require('./impact');
const result = require('./result');

function defaultFinalDeps() {
  return { geometry, terrain, hand, seasons, strata, periodAnalysis, frequency, landChange, impact, result, sentinel1, chooseBestS1Orbit };
}

/**
 * Resolve orbit pass when AUTO: compare Sentinel-1 coverage for the dry window
 * and the first two seasons, pick the pass with more total scenes.
 * Returns the resolved pass string ('ASCENDING' | 'DESCENDING').
 */
async function resolveOrbitPass(ee, { dryStart, dryEnd, seasonList, aoi, geeAdapter, deps }) {
  // Use the dry window as the pre-collection and the merged season span as post.
  const firstSeason = seasonList[0];
  const lastSeason  = seasonList[seasonList.length - 1];
  const preCollection  = deps.sentinel1.getS1Collection(ee, {
    start: dryStart, end: dryEnd, aoi, pass: 'AUTO',
  });
  const postCollection = deps.sentinel1.getS1Collection(ee, {
    start: firstSeason.start, end: lastSeason.end, aoi, pass: 'AUTO',
  });
  const best = await deps.chooseBestS1Orbit(ee, { preCollection, postCollection, geeAdapter });
  // chooseBestS1Orbit returns null when no qualifying orbit is found; fall back to ASCENDING.
  return best?.orbitPass || 'ASCENDING';
}

/**
 * Run FINAL M5 trend analysis.
 *
 * @param {object} opts
 * @param {object} opts.ee              — Earth Engine module
 * @param {object} opts.geeAdapter      — { evaluate(eeObj): Promise<any> }
 * @param {object} opts.runConfig       — validated config (must contain analysisYear)
 * @param {string} [opts.runMode]       — 'product' | 'calibration'
 * @param {object} [opts.authoritativeGeoJson]
 * @param {object} [opts.deps]
 */
async function runTrendAnalysisFinal({
  ee,
  geeAdapter,
  runConfig,
  runMode = 'product',
  authoritativeGeoJson = null,
  deps = defaultFinalDeps(),
} = {}) {
  if (!ee) throw new Error('trend/final.runTrendAnalysisFinal requires the ee module');
  if (!geeAdapter?.evaluate) throw new Error('trend/final.runTrendAnalysisFinal requires geeAdapter.evaluate');
  if (!runConfig?.analysisYear) throw new Error('trend/final.runTrendAnalysisFinal requires runConfig.analysisYear');
  assertValidMode(runMode);

  const config = { ...TREND_FINAL_DEFAULTS, ...runConfig, mode: runMode };
  const analysisYear = config.analysisYear;

  // ── AOI ──────────────────────────────────────────────────────────────────
  const { geometry: aoi, source: aoiSource } = deps.geometry.loadAoi(ee, { authoritativeGeoJson });

  // ── Seasons ───────────────────────────────────────────────────────────────
  const seasonList = deps.seasons.buildSeasons(analysisYear);
  const { start: dryStart, end: dryEnd } = deps.seasons.buildDryWindow(analysisYear);

  // ── Orbit resolution ──────────────────────────────────────────────────────
  const orbitRequested = config.orbitPass;
  let orbitSelected = orbitRequested;
  if (orbitRequested === 'AUTO') {
    orbitSelected = await resolveOrbitPass(ee, { dryStart, dryEnd, seasonList, aoi, geeAdapter, deps });
    config.orbitPass = orbitSelected;
  }

  // ── Terrain ───────────────────────────────────────────────────────────────
  const terrainStack = deps.terrain.buildTerrainStack(ee);
  const handStack    = deps.hand.buildHandStack(ee, terrainStack.slope);

  // ── Water masks ───────────────────────────────────────────────────────────
  const gswImage = ee.Image(ASSETS.JRC_GSW);
  const permWater = permanentWater(ee, { gsw: gswImage });

  // ── WorldCover ────────────────────────────────────────────────────────────
  const worldCoverImage = ee.ImageCollection(ASSETS.WORLDCOVER).first();

  // ── Reference (dry season) ────────────────────────────────────────────────
  const reference = deps.periodAnalysis.buildReference(ee, { dryStart, dryEnd, aoi, config });

  // ── Stratification ────────────────────────────────────────────────────────
  const strataResult = deps.strata.buildStrata(ee, {
    referenceVhNatural: reference.image,
    gswImage,
    worldCoverImage,
    config,
  });

  // ── Per-season flood detection ────────────────────────────────────────────
  const periodImages = seasonList.map((season) =>
    deps.periodAnalysis.buildPeriodFloodFinal(ee, {
      period: season,
      aoi,
      reference,
      strata: strataResult,
      slope: terrainStack.slope,
      hand: handStack.hand,
      permanentWater: permWater,
      config,
    }),
  );

  // ── Frequency products ────────────────────────────────────────────────────
  const validCount = ee.ImageCollection(periodImages)
    .filter(ee.Filter.eq('valid', 1)).size();

  const {
    floodCollection,
    validCollection,
    frequencyCount,
    floodFrequencyPercent,
    floodExtent,
    frequentFlood,
  } = deps.frequency.buildFloodFrequency(ee, {
    periodImages,
    validCount,
    freqAlertMin: config.freqAlertMin,
  });

  const newFlood = deps.frequency.buildNewFlood(ee, { validCollection, validCount });

  // ── Land-cover change ─────────────────────────────────────────────────────
  const { pondToBuilt, drainageSensitive, encroachmentAlert } =
    deps.landChange.buildLandChangeProducts(ee, {
      aoi,
      elevation: terrainStack.elevation,
      frequencyCount,
      config,
    });

  // ── Impact ────────────────────────────────────────────────────────────────
  const { popAffected, cropAffected, builtAffected } =
    deps.impact.buildImpactProducts(ee, { aoi, floodExtent, worldCoverImage });

  // ── Collect artifacts ─────────────────────────────────────────────────────
  const artifacts = {
    flood_extent:        floodExtent.clip(aoi),
    flood_frequency:     frequencyCount.clip(aoi),
    frequent_flood:      frequentFlood.clip(aoi),
    new_flood:           newFlood.clip(aoi),
    pop_affected:        popAffected,
    crop_affected:       cropAffected,
    built_affected:      builtAffected,
    pond_to_built:       pondToBuilt,
    drainage_sensitive:  drainageSensitive,
    encroachment_alert:  encroachmentAlert,
    stratum:             strataResult.stratumImage.clip(aoi),
  };

  // ── Area statistics ───────────────────────────────────────────────────────
  const pixelAreaHa = ee.Image.pixelArea().divide(10000);
  const reduceOpts = { reducer: ee.Reducer.sum(), geometry: aoi, scale: 30, maxPixels: 1e10, bestEffort: true };

  const floodExtentArea  = floodExtent.unmask(0).rename('flood_extent').multiply(pixelAreaHa).reduceRegion(reduceOpts);
  const frequentFloodArea = frequentFlood.unmask(0).rename('frequent_flood').multiply(pixelAreaHa).reduceRegion(reduceOpts);
  const newFloodArea     = newFlood.unmask(0).rename('new_flood').multiply(pixelAreaHa).reduceRegion(reduceOpts);
  const cropArea         = cropAffected.unmask(0).rename('crop_affected').multiply(pixelAreaHa).reduceRegion(reduceOpts);
  const builtArea        = builtAffected.unmask(0).rename('built_affected').multiply(pixelAreaHa).reduceRegion(reduceOpts);
  const popSum           = popAffected.unmask(0).rename('pop_affected').reduceRegion(reduceOpts);

  // Per-season S1 image counts
  const seasonImageCounts = seasonList.map((season) =>
    deps.sentinel1.getS1Collection(ee, {
      start: season.start, end: season.end, aoi, pass: config.orbitPass,
    }).size(),
  );

  // ── Evaluate server-side scalars ──────────────────────────────────────────
  const [
    validPeriodCount,
    drySceneCount,
    floodExtentAreaVal,
    frequentFloodAreaVal,
    newFloodAreaVal,
    cropAreaVal,
    builtAreaVal,
    popSumVal,
    ...seasonImageCountVals
  ] = await Promise.all([
    geeAdapter.evaluate(validCount),
    geeAdapter.evaluate(reference.count),
    geeAdapter.evaluate(floodExtentArea),
    geeAdapter.evaluate(frequentFloodArea),
    geeAdapter.evaluate(newFloodArea),
    geeAdapter.evaluate(cropArea),
    geeAdapter.evaluate(builtArea),
    geeAdapter.evaluate(popSum),
    ...seasonImageCounts.map((c) => geeAdapter.evaluate(c)),
  ]);

  const warnings = [
    ...(terrainStack.isFallback ? ['TERRAIN_FELL_BACK_TO_DSM'] : []),
    ...(terrainStack.nonCommercial ? ['NON_COMMERCIAL_DTM_FABDEM'] : []),
    ...(Number(validPeriodCount) < 2 ? ['INSUFFICIENT_VALID_PERIODS_FOR_NEW_FLOOD'] : []),
    ...(Number(drySceneCount) === 0 ? ['NO_DRY_SEASON_IMAGES'] : []),
  ];

  return {
    artifacts,
    catalog: deps.result.selectFinalArtifacts({ runMode }),
    metadata: {
      pipelineVersion: versions.pipelineVersionFor('trendFinal'),
      configVersion: versions.CONFIG_VERSION,
      aoiSource,
      analysisYear,
      dryWindow:       { start: dryStart, end: dryEnd },
      analysisPeriods: seasonList.map((s, i) => ({
        label: s.label, start: s.start, end: s.end,
        imageCount: Number(seasonImageCountVals[i]),
        valid: Number(seasonImageCountVals[i]) > 0,
      })),
      totalPeriods:    seasonList.length,
      validPeriodCount: Number(validPeriodCount),
      drySceneCount:    Number(drySceneCount),
      orbitRequested,
      orbitSelected,
      polarization:     'VH',
      thresholdMethod:  config.useOtsu ? 'Otsu_dynamic' : 'Fixed',
      floodRatioFallback: config.floodRatioThresh,
      otsuRatioMin:     config.otsuRatioMin,
      otsuRatioMax:     config.otsuRatioMax,
      slopeThresholdDeg: config.slopeThresh,
      useHand:          config.useHand,
      handThresholdM:   config.handThresh,
      permWaterMonths:  config.permWaterMonths,
      freqAlertMin:     config.freqAlertMin,
      elevLowland:      config.elevLowland,
      areaStats: {
        floodExtentAreaHa:    Number((floodExtentAreaVal?.flood_extent   ?? 0).toFixed(1)),
        frequentFloodAreaHa:  Number((frequentFloodAreaVal?.frequent_flood ?? 0).toFixed(1)),
        newFloodAreaHa:       Number((newFloodAreaVal?.new_flood          ?? 0).toFixed(1)),
        cropAffectedAreaHa:   Number((cropAreaVal?.crop_affected          ?? 0).toFixed(1)),
        builtAffectedAreaHa:  Number((builtAreaVal?.built_affected        ?? 0).toFixed(1)),
        populationAffected:   Math.round(popSumVal?.pop_affected          ?? 0),
      },
      warnings,
    },
    diagnostics: shouldEnableDiagnostics({ mode: runMode })
      ? { totalSeasons: seasonList.length, analysisYear }
      : null,
  };
}

module.exports = { runTrendAnalysisFinal, defaultFinalDeps };
