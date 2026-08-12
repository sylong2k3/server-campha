'use strict';

/**
 * Water-related masks derived from JRC Global Surface Water.
 *
 * Locked thresholds (Flood_D:189–190, floodTrend:297–298):
 *   - permanent water: occurrence ≥ 90 % OR seasonality ≥ 8 months
 *   - ephemeral / seasonal water (M5): 5 % < occurrence ≤ 75 %
 *   - tidal uncertainty (§80): historical water AND elevation ≤ 5 m AND
 *     WC water/wetland/bare AND NOT permanent — a PROXY, never confirmed flood
 *
 * @source docs/Flood_D_final.js (lines 692–783)
 * @source docs/floodTrend_ft_final.js (lines 1263–1331)
 * @dataset ASSETS.JRC_GSW, ASSETS.WORLDCOVER
 */

const { ASSETS } = require('./datasets');

// ── Locked thresholds ───────────────────────────────────────────────────────
const PERMANENT_WATER_OCCURRENCE = 90; // Flood_D:189
const PERMANENT_WATER_SEASONALITY_MONTHS = 8; // Flood_D:190
const EPHEMERAL_WATER_OCC_MIN = 5; // floodTrend:297
const EPHEMERAL_WATER_OCC_MAX = 75; // floodTrend:298
const TIDAL_ELEVATION_MAX_M = 5; // Flood_D:776

// ESA WorldCover class codes used in the tidal-uncertainty mask (§FLOOD_DATA_PROVENANCE §5).
const WC_CLASS = Object.freeze({
    WATER: 80,
    HERBACEOUS_WETLAND: 90,
    MANGROVE: 95,
    BARE_SPARSE: 60,
});

// ── Helpers ─────────────────────────────────────────────────────────────────

const loadGsw = (ee) => ee.Image(ASSETS.JRC_GSW);
const loadWorldCover = (ee) => ee.ImageCollection(ASSETS.WORLDCOVER).first();

/**
 * Permanent water mask: occurrence ≥ 90 % OR seasonality ≥ 8 months.
 * Returns a binary ee.Image (1 = permanent water, 0 elsewhere).
 */
function permanentWater(ee, { gsw = null } = {}) {
    if (!ee) {
        throw new Error('water-masks.permanentWater requires the ee module');
    }
    const image = gsw || loadGsw(ee);
    const highOcc = image.select('occurrence').gte(PERMANENT_WATER_OCCURRENCE);
    const highSeasonality = image.select('seasonality').gte(PERMANENT_WATER_SEASONALITY_MONTHS);
    return highOcc.or(highSeasonality).rename('permanent_water');
}

/**
 * Ephemeral / seasonal water mask (M5). Uses JRC occurrence within a bracket
 * so pixels that are always dry AND pixels that are always wet are both
 * excluded — only genuinely intermittent pixels survive.
 */
function ephemeralWater(ee, { gsw = null } = {}) {
    if (!ee) {
        throw new Error('water-masks.ephemeralWater requires the ee module');
    }
    const image = gsw || loadGsw(ee);
    const occ = image.select('occurrence');
    return occ
        .gt(EPHEMERAL_WATER_OCC_MIN)
        .and(occ.lte(EPHEMERAL_WATER_OCC_MAX))
        .rename('ephemeral_water');
}

/**
 * Tidal-uncertainty PROXY (§80). Flags pixels that COULD be tidal water
 * without proving it — we lack a synchronised tide-gauge feed for Cẩm Phả,
 * so this mask is only used as QA. Never mixed into confirmed flood totals.
 *
 * Rule (Flood_D:773–783):
 *   historical water (max_extent OR occurrence > 0)
 *   AND elevation ≤ 5 m
 *   AND WC water / wetland / mangrove / bare
 *   AND NOT permanent water
 *
 * @param {object} ee
 * @param {object} args
 * @param {object} args.elevationImage    — DTM (from terrain.buildTerrainStack.elevation)
 * @param {object} [args.gsw]             — pre-loaded JRC GSW image
 * @param {object} [args.worldCoverImage] — pre-loaded WorldCover image
 */
function tidalUncertainty(ee, { elevationImage, gsw = null, worldCoverImage = null } = {}) {
    if (!ee) {
        throw new Error('water-masks.tidalUncertainty requires the ee module');
    }
    if (!elevationImage) {
        throw new Error('water-masks.tidalUncertainty requires an elevation image');
    }
    const image = gsw || loadGsw(ee);
    const wc = (worldCoverImage || loadWorldCover(ee)).select('Map');

    const historical = image.select('max_extent').eq(1).or(image.select('occurrence').gt(0));
    const lowElev = elevationImage.lte(TIDAL_ELEVATION_MAX_M);
    const wcTidalCandidate = wc
        .eq(WC_CLASS.WATER)
        .or(wc.eq(WC_CLASS.HERBACEOUS_WETLAND))
        .or(wc.eq(WC_CLASS.MANGROVE))
        .or(wc.eq(WC_CLASS.BARE_SPARSE));
    const permanent = permanentWater(ee, { gsw: image });

    return historical
        .and(lowElev)
        .and(wcTidalCandidate)
        .and(permanent.not())
        .rename('tidal_uncertainty');
}

/**
 * Bundle used by M1 / M5 pipelines to avoid re-loading GSW multiple times.
 */
function buildWaterStack(ee, { elevationImage } = {}) {
    const gsw = loadGsw(ee);
    return {
        gsw,
        permanent: permanentWater(ee, { gsw }),
        ephemeral: ephemeralWater(ee, { gsw }),
        tidalUncertainty: elevationImage ? tidalUncertainty(ee, { gsw, elevationImage }) : null,
    };
}

module.exports = {
    PERMANENT_WATER_OCCURRENCE,
    PERMANENT_WATER_SEASONALITY_MONTHS,
    EPHEMERAL_WATER_OCC_MIN,
    EPHEMERAL_WATER_OCC_MAX,
    TIDAL_ELEVATION_MAX_M,
    WC_CLASS,
    loadGsw,
    loadWorldCover,
    permanentWater,
    ephemeralWater,
    tidalUncertainty,
    buildWaterStack,
};
