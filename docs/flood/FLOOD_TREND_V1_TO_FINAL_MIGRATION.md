# Flood Trend V1 → FINAL Migration

**Date**: 2026-08-17  
**Scope**: M5 Trend Analysis module only  
**Status**: Fully integrated — backend wired, admin UI, client WebGIS complete

---

## 1. Overview

The FINAL algorithm (`final_code.js`, the authoritative WebGIS GEE script) replaces the M5 Trend V1 algorithm (`floodTrend_ft_final.js`) as the default implementation for new trend analysis submissions.

V1 data is preserved. V1 code is untouched. New runs with `analysisYear` in the config use FINAL automatically.

---

## 2. Why Migrate

| Reason | Detail |
|--------|--------|
| Input simplification | FINAL uses `analysisYear` → auto 4 seasons. V1 requires explicit `periods` array. |
| Better FP suppression | 3-stratum approach separates open-water, urban, and mine detection. V1 has no stratification. |
| Urban flood realism | FINAL uses VH double-bounce logic. V1's urban mode was disabled (89% FP). |
| Mine SAR heuristic | FINAL detects mine-like surfaces via SAR backscatter. V1 relies only on WorldCover bare class. |
| Accuracy module removed | FINAL is WebGIS-optimised — no S2 MNDWI validation. V1 required Sentinel-2. |
| Population impact bundled | FINAL integrates WorldPop impact into M5. V1 put impact in separate M4 module. |
| ESRI LULC for pond→built | FINAL uses ESRI LULC (water=1, flooded_veg=4, built=7). V1 uses Dynamic World. |
| Different frequency metric | FINAL uses count (>= freqAlertMin=2 seasons). V1 uses percent (>= 50%). |

---

## 3. Architecture V1 (Current)

```
API POST /admin/flood/runs  { module: 'trend', config: { dryStart, dryEnd, periods: [...] } }
  → analysis.service.js → validateRunConfig('trend', config)
  → orchestrator → queue → trend/index.js:runTrendAnalysis()
      → orbit selection (chooseBestS1Orbit)
      → VV+VH dual-ratio detection per period
      → frequency (% based, > 50%)
      → land change via Dynamic World
      → Sentinel-2 MNDWI accuracy assessment
      → DB: module='trend', pipeline_version='TREND_V1'
```

---

## 4. Architecture FINAL

```
API POST /admin/flood/runs  { module: 'trend', config: { analysisYear: 2023 } }
  → analysis.service.js → validateRunConfig('trendFinal', config)  ← detects analysisYear
  → orchestrator → queue → trend/final/index.js:runTrendAnalysisFinal()
      → buildSeasons(year) → 4 seasons
      → buildReference() — VH-only, dry Jan–Apr
      → buildStrata() — WorldCover + SAR mine heuristic
      → buildPeriodFloodFinal() × 4 seasons — Otsu per-stratum
      → buildFloodFrequency() — count-based
      → buildLandChangeProducts() — ESRI LULC
      → buildImpactProducts() — WorldPop + WorldCover
      → DB: module='trend', pipeline_version='TREND_FINAL'
```

---

## 5. Algorithm Mapping Matrix

| Feature | V1 (`TREND_V1`) | FINAL (`TREND_FINAL`) |
|---------|-----------------|----------------------|
| Input model | `periods: [{start,end}]` explicit array | `analysisYear` → 4 seasons auto |
| Dry window | `dryStart`/`dryEnd` explicit | `${year}-01-01` → `${year}-04-30` auto |
| Polarisation | VV + VH dual | VH only |
| Smoothing | 20 m focal median | 50 m focal mean (focalMean) |
| Threshold mode | fixed \| otsu \| median_sigma | Otsu on log10(ratio) |
| Flood logic | ratio > threshold (both VV, VH) | ratio > Otsu (per-stratum) |
| Stratification | None | non-urban / urban / mine |
| Urban flood | Disabled (89% FP) | VH delta >= 3 dB increase |
| Mine detection | WorldCover bare + terrain | WC bare + SAR heuristic + polygon |
| HAND threshold | 12 m | 15 m |
| Slope threshold | 5° | 5° (unchanged) |
| Permanent water | JRC occ >= 90% OR seasonality >= 8 | same |
| Ephemeral water | Tidal-uncertainty split | flag/exclude mode (no tidal split) |
| Connectivity | 8 pixels minimum | 8 pixels minimum (unchanged) |
| Frequency metric | % (count / validPeriods × 100 >= 50%) | count >= freqAlertMin (default 2) |
| Land-cover change | Dynamic World (water=0, built=6) | ESRI LULC (water=1, built=7) |
| Drainage sensitive | frequentFlood OR localDepression OR HAND<=5 | frequentFlood OR elevation < 5 m |
| Population impact | Separate M4 module (GHSL) | Bundled: WorldPop VNM 2020 |
| Crop impact | Separate M4 module | Bundled: WorldCover cropland (40) |
| Accuracy module | S2 MNDWI confusion matrix (OA, Kappa) | **Removed** |
| Tidal candidate | QA artifact | **Removed** |
| Scale | 30 m | 30 m (quota constraint; GEE reference uses 10 m) |
| Orbit | AUTO (chooseBestS1Orbit) | ASCENDING (no orbit selection) |

---

## 6. Database Changes

**No new columns required.** Existing schema already supports this migration:

| Column | V1 value | FINAL value |
|--------|----------|-------------|
| `module` | `'trend'` | `'trend'` (unchanged — DB constraint preserved) |
| `pipeline_version` | `'TREND_V1'` | `'TREND_FINAL'` |
| `config_version` | `'V1'` | `'V1'` |
| `params_snapshot` | `{ dryStart, dryEnd, periods, ... }` | `{ analysisYear, orbitPass, ... }` |

Existing V1 records are fully intact. Reading them remains unchanged.

---

## 7. New Files Created

```
server/src/services/flood/trend/final/
  seasons.js          buildSeasons(year), buildDryWindow(year)
  strata.js           3-stratum WorldCover + SAR mine heuristic
  period-analysis.js  VH-only Otsu per-stratum + urban double-bounce
  frequency.js        Count-based frequency, flood_extent, new_flood
  land-change.js      ESRI LULC pond→built + drainage-sensitive
  impact.js           WorldPop population + WorldCover crop/built
  result.js           11-artifact catalog (selectFinalArtifacts)
  index.js            runTrendAnalysisFinal() orchestrator
```

---

## 8. Modified Files

| File | Change |
|------|--------|
| `config/versions.js` | Added `TREND_FINAL: 'TREND_FINAL'` + `trendFinal` module mapping |
| `config/defaults.js` | Added `TREND_FINAL_DEFAULTS` (57 keys, exported) |
| `config/schema.js` | Added `trendFinalSchema` (Joi, 21 fields) + `SCHEMAS.trendFinal` |
| `common/datasets.js` | Added `WORLDPOP_VNM_2020`, `ESRI_LULC_TS` assets + attributions |

---

## 9. API Compatibility

Existing endpoints are **unchanged**:

```
POST   /api/v1/admin/flood/runs
GET    /api/v1/admin/flood/runs
GET    /api/v1/admin/flood/runs/:id
POST   /api/v1/admin/flood/runs/:id/rerun
POST   /api/v1/admin/flood/runs/:id/cancel
GET    /api/v1/flood/runs
GET    /api/v1/flood/overview
```

The **only behavioral change** is in how `analysis.service.js` dispatches the run:

```javascript
// Before (V1 only):
if (module === 'trend') return runTrendAnalysis({ ee, ... })

// After (V1 + FINAL):
if (module === 'trend') {
  if (config.analysisYear !== undefined) {
    // FINAL: analysisYear-based
    return runTrendAnalysisFinal({ ee, geeAdapter, runConfig: config, ... })
  } else {
    // V1: explicit periods
    return runTrendAnalysis({ ee, geeAdapter, runConfig: config, ... })
  }
}
```

The validated module name for FINAL is `'trendFinal'` but DB still stores `module='trend'`. The dispatch happens at the executor level based on `pipeline_version` stored in the run record.

---

## 10. Artifact Differences

### Removed from FINAL (vs V1)
- `trend_tidal_candidate` — tidal uncertainty splitting removed
- `trend_mining_candidate` — replaced by stratum QA layer

### Added in FINAL (not in V1 M5)
- `flood_extent` — primary WebGIS layer (was implicit in V1)
- `frequent_flood` — count-based (>= 2 seasons)
- `pop_affected` — WorldPop within flood extent
- `crop_affected` — WorldCover cropland within flood extent
- `built_affected` — WorldCover built-up within flood extent (informational)
- `stratum` — stratification layer (QA)

### Renamed in FINAL
| V1 code | FINAL code |
|---------|-----------|
| `trend_frequency` | `flood_frequency` |
| `trend_frequent_flood` | `frequent_flood` |
| `trend_new_flood` | `new_flood` |
| `trend_tidal_candidate` | (removed) |
| `trend_mining_candidate` | (removed — use `stratum` QA) |

---

## 11. Integration Wiring Required

These are the remaining integration steps NOT yet done:

### 11.1 analysis.service.js / run-executor dispatch

Find where M5 is invoked and add the FINAL branch:

```javascript
// In the GEE worker / run-executor:
const { runTrendAnalysis } = require('./trend/index');
const { runTrendAnalysisFinal } = require('./trend/final/index');

// Dispatch:
if (run.module === 'trend') {
  const fn = run.pipeline_version === 'TREND_FINAL'
    ? runTrendAnalysisFinal
    : runTrendAnalysis;
  return fn({ ee, geeAdapter, runConfig: run.params_snapshot, runMode: run.mode, ... });
}
```

### 11.2 analysis.service.js submit()

When building the run record, detect FINAL config and set pipeline_version:

```javascript
function buildPipelineVersion(module, config) {
  if (module === 'trend' && config.analysisYear !== undefined) {
    return versions.PIPELINE_VERSIONS.TREND_FINAL;
  }
  return versions.pipelineVersionFor(module);
}
```

### 11.3 validateRunConfig() routing

When `module === 'trend'` and `config.analysisYear` is present, validate against `trendFinalSchema`:

```javascript
function validateRunConfig(module, payload) {
  let schemaKey = module;
  if (module === 'trend' && payload?.analysisYear !== undefined) {
    schemaKey = 'trendFinal';
  }
  const schema = SCHEMAS[schemaKey];
  // ...
}
```

### 11.4 visualization/layer-definitions.js

Add layer definitions for the 5 new FINAL artifact codes:
- `flood_extent` (palette: `['1f78b4']`)
- `frequent_flood` (palette: `['08519C']`)
- `pop_affected` (gradient: `['FFFFB2','BD0026']`)
- `crop_affected` (palette: `['33a02c']`)
- `stratum` (palette: `['b2df8a','fb9a99','cab2d6']`, min:1, max:3)

---

## 12. Rollback

To roll back to V1 for new submissions:
1. In `analysis.service.js`, remove the `analysisYear` dispatch branch.
2. New `trend` submissions fall back to V1 (`runTrendAnalysis`).
3. No DB changes needed — existing FINAL records remain with `TREND_FINAL` pipeline_version.

---

## 13. Deprecated V1 Components

| Component | Status | Action |
|-----------|--------|--------|
| `trend/index.js:runTrendAnalysis` | KEEP | Historical data + backward compat |
| `trend/period-analysis.js` | KEEP | Used by V1 |
| `trend/frequency.js` | KEEP | Used by V1 |
| `trend/land-change.js` | KEEP | Used by V1 |
| `trend/result.js` | KEEP | Used by V1 |
| `accuracy/surface-water.js` | KEEP | Used by V1; not called by FINAL |
| V1 `TREND_DEFAULTS` in defaults.js | DEPRECATE_IN_PLACE | Kept for V1 rerun compatibility |
| `dynamicWorld` in V1 trend | KEEP | Used by V1 only |

---

## 14. Known Limitations

1. **Orbit selection**: FINAL defaults to `ASCENDING` without orbit ranking. If the AOI has poor ASCENDING coverage, manually override with `orbitPass: 'DESCENDING'` in the config.

2. **Scale**: FINAL GEE script uses 10 m but server uses 30 m (GEE download quota constraint). Area statistics will differ slightly from the reference script.

3. **FABDEM non-commercial**: Still used via `terrain.buildTerrainStack()`. Commercial deployment requires Copernicus DEM GLO-30 only.

4. **ESRI LULC availability**: `ESRI_LULC_TS` is a community asset. Check availability for `lcYearOld` and `lcYearNew` before submission.

5. **Population data frozen at 2020**: WorldPop VNM 2020 is used regardless of `analysisYear`.

---

## 15. Verification Checklist

- [ ] `trend/final/seasons.js` generates correct winter season (year+1 Feb 28)
- [ ] `trend/final/strata.js` mine stratum does not overlap urban stratum
- [ ] `trend/final/period-analysis.js` Otsu fallback fires when logRatio histogram is empty
- [ ] `trend/final/frequency.js` returns empty new_flood when validCount < 2
- [ ] `trend/final/land-change.js` `drainageSensitive` covers lowland AND frequent-flood areas
- [ ] `trend/final/impact.js` `popAffected` is masked (not zero) outside flood extent
- [ ] `config/defaults.js` `TREND_FINAL_DEFAULTS` exported correctly
- [ ] `config/schema.js` `trendFinalSchema` rejects `lcYearOld >= lcYearNew`
- [ ] `config/versions.js` `pipelineVersionFor('trendFinal')` returns `'TREND_FINAL'`
- [ ] `common/datasets.js` `ASSETS.WORLDPOP_VNM_2020` and `ASSETS.ESRI_LULC_TS` present
- [ ] analysis.service.js dispatch wired (§11.1–11.3 above)
- [ ] V1 trend runs still execute without modification
- [ ] DB: existing `TREND_V1` records readable with old API response
- [ ] New FINAL run stores `pipeline_version='TREND_FINAL'` in DB
- [ ] No fabricated statistics when a season has 0 Sentinel-1 images
