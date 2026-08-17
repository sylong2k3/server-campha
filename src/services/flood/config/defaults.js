'use strict';

/**
 * Scientific defaults for the flood domain.
 *
 * EVERY threshold below is transcribed verbatim from Flood_D_final.js and
 * MUST NOT be changed without evidence per §15 non-negotiable rule:
 *     OLD / NEW / REASON / EVIDENCE / EXPECTED IMPACT / VALIDATION REQUIRED
 *
 * The line references point back to docs/Flood_D_final.js so any auditor can
 * verify one-to-one correspondence.
 *
 * @source docs/Flood_D_final.js (lines noted per-value)
 * @rule   architecture doc §15 (scientific-behaviour lock)
 * @rule   architecture doc §16 (M3 uses "Risk Index" terminology, not probability)
 * @rule   architecture doc §19 (product / calibration split; calibration
 *         outputs never auto-publish)
 */

// ── Sentinel-1 threshold vector (Flood_D lines 108–120) ──────────────────────
// Small numeric constants named after the paper; used together in the classifier.
const S1_THRESHOLDS = Object.freeze({
    // Flood_D:109 — VH must decrease at least 2 dB to vote flood.
    vhDecreaseDb: 2.0,
    // Flood_D:110 — VV must decrease at least 0.8 dB (support for dark flood).
    vvDecreaseDb: 0.8,
    // Flood_D:111 — pre/post VH linear ratio bar.
    vhRatio: 1.3,
    // Flood_D:112 — absolute VH floor for open water (dark flood).
    postVHDb: -18,
    // Flood_D:113 — absolute VV floor (dark-flood support check).
    postVVDb: -11,
    // Flood_D:114 — adaptive VH-decrease cap (log10 conversion).
    maximumRatio: 2.5,
});

// ── Terrain / datasets (Flood_D lines 122–127) ──────────────────────────────
// FABDEM: community DTM. NON-COMMERCIAL license — see FLOOD_DATA_PROVENANCE.md §8.
const FABDEM_ASSET_ID = 'projects/sat-io/open-datasets/FABDEM';
// Optional user-supplied mining polygon; empty string means "heuristic only".
const MINING_POLYGON_ASSET_ID = '';

// ── Sentinel-1 event pipeline (M1) ──────────────────────────────────────────
// Every value here mirrors Flood_D_final.js RUN_CONFIG.s1 lines 154–224.
const S1_DEFAULTS = Object.freeze({
    // Flood_D:154–157 baseline / event window template (dev-time defaults).
    preStart: '2024-01-01',
    preEnd: '2024-04-30',
    postStart: '2024-09-01',
    postEnd: '2024-09-30',
    // Flood_D:159–160 dry-season window used for false-positive testing.
    falsePositivePostStart: '2024-12-01',
    falsePositivePostEnd: '2024-12-31',
    // Flood_D:164 — orbit selection; 'AUTO' ranks candidates, else 'ASCENDING'/'DESCENDING'.
    orbitPass: 'AUTO',
    // Flood_D:172 — 'fixed' (manual) | 'otsu' | 'median_sigma'.
    thresholdMode: 'fixed',
    // Flood_D:173 — robust IQR multiplier for median_sigma mode.
    medianSigmaK: 3.5,
    // Flood_D:177 — VH fallback threshold if Otsu / adaptive fails (dB).
    vhFallbackDb: 2.0,
    // Flood_D:178–179 — Otsu acceptance band (dB).
    otsuMinDb: 1.5,
    otsuMaxDb: 5.0,
    // Flood_D:182 — hard slope cap (deg). Do NOT raise without evidence per Flood_D:82 log.
    hardMaximumSlope: 5,
    // Flood_D:183 — hard HAND cap (m).
    hardMaximumHAND: 12,
    // Flood_D:184 — max distance from water for terrain-confidence diagnostic (m).
    diagnosticWaterDistanceM: 3000,
    // Flood_D:185–188 vote/observation gates.
    minimumVotes: 2,
    minimumObservations: 2,
    minimumVoteFraction: 0.6,
    minimumAreaM2: 1000,
    // Flood_D:189–191 water-mask & dark-flood support gates.
    permanentWaterOccurrence: 90,
    permanentWaterSeasonalityMonths: 8,
    minimumDarkSupportVotes: 3,
    // Flood_D:199 event mode: single-image sufficient. minimumVotes=1 when true.
    eventMode: true,
    // Flood_D:207–209 shallow-flood branch.
    enableShallowFlood: true,
    shallowExtraDecreaseDb: 0.4,
    shallowPostVHDb: -15.5,
    // Flood_D:217 — DISABLED by default. Reference log shows 89% FP on slopes.
    // Do NOT flip without §15 evidence.
    enableUrbanDoubleBounce: false,
    // Flood_D:218–223 urban double-bounce params (only used if enabled above).
    urbanVVIncreaseDb: 1.5,
    urbanVVZ: 2.0,
    urbanVHDecreaseToleranceDb: 1.0,
    urbanBuiltDensity: 0.5,
    urbanMaximumSlope: 10,
    urbanMaximumHAND: 15,
});

// ── HAND scenario (M2) — Flood_D lines 227–228 ──────────────────────────────
const HAND_DEFAULTS = Object.freeze({
    // Flood_D:227 — scenario inundation level (m).
    levelM: 5,
    // Flood_D:228 — max slope for M2 scenario eligibility (deg).
    maximumSlope: 12,
});

// ── Impact (M4) — Flood_D lines 238–242 ─────────────────────────────────────
const IMPACT_DEFAULTS = Object.freeze({
    // Flood_D:238 — 'M1' | 'M2' | 'M3' source selector.
    impactSource: 'M1',
    // Flood_D:242 — use non-tidal (main) flood mask for area statistics.
    impactUseNonTidal: true,
});

// ── FINAL M5 trend (year-based, VH-only, 3-stratum Otsu) ────────────────────
const TREND_FINAL_DEFAULTS = Object.freeze({
    // analysisYear is REQUIRED — no default; caller must supply it
    orbitPass: 'ASCENDING',
    polarization: 'VH',

    // Reference (dry season) is built automatically from analysisYear
    // dryStart/dryEnd are set in runTrendAnalysisFinal via buildDryWindow()

    // Period padding
    periodPadDays: 10,

    // Otsu dynamic thresholding on log10(ratio)
    useOtsu: true,
    floodRatioThresh: 1.25,    // fallback when Otsu out of range
    otsuScale: 30,
    otsuMaxBuckets: 256,
    otsuLogMin: -1.0,
    otsuLogMax: 1.30,
    otsuRatioMin: 1.20,
    otsuRatioMax: 2.50,

    // Terrain filters
    slopeThresh: 5,            // degrees
    useHand: true,
    handThresh: 15,            // metres (MERIT Hydro)

    // Water masks
    permWaterMonths: 8,        // JRC seasonality threshold

    // Connectivity filter
    connMin: 8,
    connMax: 100,

    // Frequency classification
    freqAlertMin: 2,           // seasons count (not percent)

    // Lowland classification
    elevLowland: 5,            // metres

    // Land-cover change detection (ESRI LULC years)
    lcYearOld: 2018,
    lcYearNew: 2023,

    // Stratification
    useStratification: true,
    stratSource: 'WORLDCOVER',  // 'WORLDCOVER' | 'ESRI'
    minePolygonAsset: '',       // '' = no authoritative polygon

    // Mine stratum
    mineFromBareGround: true,
    excludeMineStratumFromProduct: true,
    useMineLikeSAR: true,
    mineLikeDbMax: -17,         // VH dB (dry) below = mine-like
    mineLikeOccMax: 5,          // JRC occurrence % below = not water

    // Ephemeral water
    ephemeralWaterMode: 'flag', // 'flag' | 'exclude'
    ephemeralOccMin: 5,
    ephemeralOccMax: 75,

    // Urban flood (double-bounce)
    useUrbanFloodLogic: true,
    urbanDeltaUpDb: 3.0,        // VH increase threshold (dB)
});

// ── Run orchestrator toggles — Flood_D lines 136–144 ────────────────────────
const RUN_MODES = Object.freeze(['product', 'calibration']);
const DEFAULT_RUN_MODE = 'product';

const RUN_CONFIG_TOGGLES = Object.freeze({
    // Flood_D:141
    autoRunM1: true,
    // Flood_D:144
    runImpactAfterM1: true,
});

// ── AOI (§82 provenance) ────────────────────────────────────────────────────
// Cẩm Phả boundary defaults. Real geometry loading lives in
// services/flood/common/geometry.js.
const AOI_DEFAULTS = Object.freeze({
    source: 'REFERENCE_GAUL',
    gaulFilter: { ADM2_NAME: 'Cam Pha' },
});

// ── Analysis projection ─────────────────────────────────────────────────────
const PROJECTION = Object.freeze({
    crs: 'EPSG:32648',
    scaleM: 30,
});

module.exports = {
    S1_THRESHOLDS,
    FABDEM_ASSET_ID,
    MINING_POLYGON_ASSET_ID,
    S1_DEFAULTS,
    HAND_DEFAULTS,
    IMPACT_DEFAULTS,
    TREND_FINAL_DEFAULTS,
    RUN_MODES,
    DEFAULT_RUN_MODE,
    RUN_CONFIG_TOGGLES,
    AOI_DEFAULTS,
    PROJECTION,
};
