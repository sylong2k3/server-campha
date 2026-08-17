'use strict';

/**
 * Single source of truth for every Earth Engine asset the flood domain reads.
 *
 * Every module under services/flood/** MUST attribute the datasets it uses
 * via an `@dataset` JSDoc tag pointing back here — @docs/FLOOD_DATA_PROVENANCE.md
 * documents license posture, resolution, and fallback risk.
 *
 * @rule architecture doc §15 — no asset ID changes without evidence
 * @rule §71 — never leak GEE service key contents; asset IDs are public constants
 */

const ASSETS = Object.freeze({
    // Vector — Cẩm Phả township polygon (FLOOD_DATA_PROVENANCE.md §13).
    FAO_GAUL_LEVEL2: 'FAO/GAUL/2015/level2',

    // Sentinel-1 SAR GRD (M1 event, M5 trend) — §1.
    SENTINEL1_GRD: 'COPERNICUS/S1_GRD',

    // Sentinel-2 Surface Reflectance harmonised (M5 validation, M1 QA) — §2.
    SENTINEL2_SR_HARMONIZED: 'COPERNICUS/S2_SR_HARMONIZED',

    // Sentinel-2 Cloud Score+ (M5 cloud mask) — §3.
    CLOUD_SCORE_PLUS: 'GOOGLE/CLOUD_SCORE_PLUS/V1/S2_HARMONIZED',

    // Google Dynamic World v1 (M1 built + flooded veg, M5 pond→built) — §4.
    DYNAMIC_WORLD: 'GOOGLE/DYNAMICWORLD/V1',

    // ESA WorldCover v200 (M1 mining candidate, M4 cropland) — §5.
    WORLDCOVER: 'ESA/WorldCover/v200',

    // JRC Global Surface Water v1.4 (permanent water, ephemeral, tidal proxy) — §6.
    JRC_GSW: 'JRC/GSW1_4/GlobalSurfaceWater',

    // MERIT Hydro v1.0.1 (HAND, UPA, flow direction) — §7.
    MERIT_HYDRO: 'MERIT/Hydro/v1_0_1',

    // FABDEM — community-hosted DTM (§8). CC-BY-4.0-NC — flag before commercial deployment.
    FABDEM: 'projects/sat-io/open-datasets/FABDEM',

    // Copernicus DEM GLO-30 (2024_1) — DSM. FABDEM fallback (§9).
    COPERNICUS_DEM_GLO30: 'COPERNICUS/DEM/GLO30_2024_1',

    // GHSL population grid 2020 (M4 affected population) — §10.
    GHSL_POP_2020: 'JRC/GHSL/P2023A/GHS_POP/2020',

    // NASA GPM IMERG V07 (M3 event rainfall) — §11.
    IMERG_V07: 'NASA/GPM_L3/IMERG_V07',

    // UCSB CHIRPS Daily RNL v3 (M3 antecedent rainfall) — §12.
    CHIRPS_DAILY_RNL: 'UCSB-CHC/CHIRPS/V3/DAILY_RNL',

    // WorldPop population grid VNM 2020 (FINAL M5 impact) — 100 m.
    WORLDPOP_VNM_2020: 'WorldPop/GP/100m/pop/VNM_2020',

    // ESRI Global LULC 10 m Time Series (FINAL M5 land-change detection).
    ESRI_LULC_TS: 'projects/sat-io/open-datasets/landcover/ESRI_Global-LULC_10m_TS',
});

/**
 * Attribution strings baked into every published artifact's metadata JSON so
 * downstream consumers see licenses without re-deriving them.
 * @rule FLOOD_DATA_PROVENANCE.md §15
 */
const ATTRIBUTIONS = Object.freeze([
    'Contains modified Copernicus Sentinel data (2014–present) / ESA',
    '© ESA WorldCover project 2021',
    'European Commission, Joint Research Centre (JRC): GSW v1.4, GHSL POP 2020',
    'Google Dynamic World v1 (CC-BY-4.0)',
    'Google Cloud Score+ for Sentinel-2 (GEE ToS)',
    'MERIT Hydro (Yamazaki et al. 2019)',
    'FABDEM DTM (Hawker et al. 2022) — CC-BY-4.0-NC',
    'Copernicus DEM GLO-30 (2024_1) / ESA',
    'NASA GPM IMERG V07 (Huffman et al. 2019)',
    'UCSB CHIRPS Daily RNL v3 (Funk et al. 2015)',
    'FAO GAUL 2015',
    'WorldPop Population Grid VNM 2020 / University of Southampton',
    'ESRI Global LULC 10m TS (Karra et al. 2021)',
]);

/**
 * Whether a dataset needs a license flag in the published artifact metadata.
 * Used by the orchestrator when building the artifact.rasterGeeMetadata JSON.
 */
const NON_COMMERCIAL = Object.freeze(new Set([ASSETS.FABDEM]));

module.exports = {
    ASSETS,
    ATTRIBUTIONS,
    NON_COMMERCIAL,
};
