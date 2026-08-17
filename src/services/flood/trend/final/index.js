'use strict';

/**
 * M5 Monitoring orchestrator: single-period flood detection with auto-derived
 * dry-season reference.
 *
 * NEW model (replaces annual 4-season TREND_FINAL):
 *   Input:  monitorStart + monitorEnd  (one arbitrary monitoring window)
 *   Dry season: derived automatically via computeDrySeason(monitorStart)
 *               — no user input required for the reference window.
 *   Output: flood_extent, flood_frequency (0/1), frequent_flood, impact
 *           products, land-change, drainage-risk.  NO new_flood (needs 2 periods).
 *
 * @ported-from new_code.js (entire script — §0–§9)
 * @pipeline TREND_MONITORING_V1
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
 * and the monitoring window, pick the pass with more total scenes.
 */
async function resolveOrbitPass(ee, { dryStart, dryEnd, monitorStart, monitorEnd, aoi, geeAdapter, deps }) {
  const preCollection  = deps.sentinel1.getS1Collection(ee, {
    start: dryStart, end: dryEnd, aoi, pass: 'AUTO',
  });
  const postCollection = deps.sentinel1.getS1Collection(ee, {
    start: monitorStart, end: monitorEnd, aoi, pass: 'AUTO',
  });
  const best = await deps.chooseBestS1Orbit(ee, { preCollection, postCollection, geeAdapter });
  return best?.orbitPass || 'ASCENDING';
}

/**
 * Run M5 monitoring-period flood analysis.
 *
 * @param {object} opts
 * @param {object} opts.ee              — Earth Engine module
 * @param {object} opts.geeAdapter      — { evaluate(eeObj): Promise<any> }
 * @param {object} opts.runConfig       — validated config (must contain monitorStart + monitorEnd)
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
  if (!runConfig?.monitorStart || !runConfig?.monitorEnd) {
    throw new Error('trend/final.runTrendAnalysisFinal requires runConfig.monitorStart and runConfig.monitorEnd');
  }
  assertValidMode(runMode);

  const config = { ...TREND_FINAL_DEFAULTS, ...runConfig, mode: runMode };
  const { monitorStart, monitorEnd } = config;

  // ── AOI ──────────────────────────────────────────────────────────────────
  const { geometry: aoi, source: aoiSource } = deps.geometry.loadAoi(ee, { authoritativeGeoJson });

  // ── Dry-season reference window (auto-derived) ────────────────────────────
  const { start: dryStart, end: dryEnd } = deps.seasons.computeDrySeason(
    monitorStart,
    config.dryMonthStart,
    config.dryMonthEnd,
  );

  // ── Orbit resolution ──────────────────────────────────────────────────────
  const orbitRequested = config.orbitPass;
  let orbitSelected = orbitRequested;
  if (orbitRequested === 'AUTO') {
    orbitSelected = await resolveOrbitPass(ee, {
      dryStart, dryEnd, monitorStart, monitorEnd, aoi, geeAdapter, deps,
    });
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

  // ── Stratification (depends on dry-season reference) ─────────────────────
  const strataResult = deps.strata.buildStrata(ee, {
    referenceVhNatural: reference.image,
    gswImage,
    worldCoverImage,
    config,
  });

  // ── Single-period flood detection ─────────────────────────────────────────
  const monitoringPeriod = { label: 'Kỳ giám sát', start: monitorStart, end: monitorEnd };

  const periodImage = deps.periodAnalysis.buildPeriodFloodFinal(ee, {
    period: monitoringPeriod,
    aoi,
    reference,
    strata: strataResult,
    slope: terrainStack.slope,
    hand: handStack.hand,
    permanentWater: permWater,
    config,
  });

  // ── Frequency products (single image — frequency is 0 or 1) ───────────────
  const periodImages = [periodImage];
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
  const cropArea         = cropAffected.unmask(0).rename('crop_affected').multiply(pixelAreaHa).reduceRegion(reduceOpts);
  const builtArea        = builtAffected.unmask(0).rename('built_affected').multiply(pixelAreaHa).reduceRegion(reduceOpts);
  const popSum           = popAffected.unmask(0).rename('pop_affected').reduceRegion(reduceOpts);
  const drainageAlertArea = encroachmentAlert.unmask(0).rename('encroachment_alert').multiply(pixelAreaHa).reduceRegion(reduceOpts);

  // Count Sentinel-1 scenes in the monitoring window (post-evaluation for metadata)
  const monitorImageCount = deps.sentinel1.getS1Collection(ee, {
    start: monitorStart, end: monitorEnd, aoi, pass: config.orbitPass,
  }).size();

  // ── Evaluate server-side scalars ──────────────────────────────────────────
  const [
    validPeriodCount,
    drySceneCount,
    monitorSceneCount,
    floodExtentAreaVal,
    cropAreaVal,
    builtAreaVal,
    popSumVal,
    drainageAlertAreaVal,
    periodOtsuThreshold,
  ] = await Promise.all([
    geeAdapter.evaluate(validCount),
    geeAdapter.evaluate(reference.count),
    geeAdapter.evaluate(monitorImageCount),
    geeAdapter.evaluate(floodExtentArea),
    geeAdapter.evaluate(cropArea),
    geeAdapter.evaluate(builtArea),
    geeAdapter.evaluate(popSum),
    geeAdapter.evaluate(drainageAlertArea),
    geeAdapter.evaluate(periodImage.get('otsu_threshold')),
  ]);

  const warnings = [
    ...(terrainStack.isFallback ? ['TERRAIN_FELL_BACK_TO_DSM'] : []),
    ...(terrainStack.nonCommercial ? ['NON_COMMERCIAL_DTM_FABDEM'] : []),
    ...(Number(drySceneCount) === 0 ? ['NO_DRY_SEASON_IMAGES'] : []),
    ...(Number(monitorSceneCount) === 0 ? ['NO_MONITOR_PERIOD_IMAGES'] : []),
  ];

  return {
    artifacts,
    catalog: deps.result.selectFinalArtifacts({ runMode }),
    metadata: {
      pipelineVersion: versions.pipelineVersionFor('trendFinal'),
      configVersion:   versions.CONFIG_VERSION,
      aoiSource,
      monitorStart,
      monitorEnd,
      dryWindow:       { start: dryStart, end: dryEnd },
      analysisPeriods: [{
        label:      monitoringPeriod.label,
        start:      monitorStart,
        end:        monitorEnd,
        imageCount: Number(monitorSceneCount),
        valid:      Number(monitorSceneCount) > 0,
      }],
      totalPeriods:    1,
      validPeriodCount: Number(validPeriodCount),
      drySceneCount:    Number(drySceneCount),
      orbitRequested,
      orbitSelected,
      polarization:     'VH',
      thresholdMethod:  config.useOtsu ? 'Otsu_dynamic' : 'Fixed',
      floodRatioFallback: config.floodRatioThresh,
      otsuRatioMin:     config.otsuRatioMin,
      otsuRatioMax:     config.otsuRatioMax,
      otsuThreshold:    periodOtsuThreshold,
      slopeThresholdDeg: config.slopeThresh,
      useHand:          config.useHand,
      handThresholdM:   config.handThresh,
      permWaterMonths:  config.permWaterMonths,
      freqAlertMin:     config.freqAlertMin,
      elevLowland:      config.elevLowland,
      areaStats: {
        floodExtentAreaHa:    Number((floodExtentAreaVal?.flood_extent  ?? 0).toFixed(1)),
        cropAffectedAreaHa:   Number((cropAreaVal?.crop_affected        ?? 0).toFixed(1)),
        builtAffectedAreaHa:  Number((builtAreaVal?.built_affected      ?? 0).toFixed(1)),
        populationAffected:   Math.round(popSumVal?.pop_affected        ?? 0),
        drainageAlertAreaHa:  Number((drainageAlertAreaVal?.encroachment_alert ?? 0).toFixed(1)),
      },
      warnings,
    },
    diagnostics: shouldEnableDiagnostics({ mode: runMode })
      ? { monitorStart, monitorEnd, dryWindow: { start: dryStart, end: dryEnd } }
      : null,
  };
}

module.exports = { runTrendAnalysisFinal, defaultFinalDeps };
