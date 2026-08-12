'use strict';

/**
 * Sentinel-1 preparation primitives — shared by M1 (event flood) and M5 (trend).
 *
 * Every function takes `ee` (the Earth Engine SDK) as its first argument so
 * the module stays import-safe before Earth Engine is initialised, and so
 * tests can substitute a fake ee.
 *
 * @source docs/Flood_D_final.js (lines 1588–1755)
 * @source docs/floodTrend_ft_final.js (lines 886–1180)
 * @dataset services/flood/common/datasets.js ASSETS.SENTINEL1_GRD
 * @rule    architecture doc §15 (thresholds locked)
 * @rule    §90 M5 REUSES these helpers rather than duplicating them
 */

const { ASSETS } = require('./datasets');

// ── Constants from Flood_D_final.js — locked values ─────────────────────────

/** Focal-median kernel radius for speckle filter (Flood_D:1636). */
const SPECKLE_RADIUS_M = 20;

/** Valid Sentinel-1 IW incidence-angle window (Flood_D:1600–1603). */
const INCIDENCE_ANGLE_MIN_DEG = 31;
const INCIDENCE_ANGLE_MAX_DEG = 45;

/** Valid VV dynamic range in dB (Flood_D:1609–1612). */
const VV_MIN_DB = -35;
const VV_MAX_DB = 5;

/** Valid VH dynamic range in dB (Flood_D:1615–1618). */
const VH_MIN_DB = -40;
const VH_MAX_DB = 0;

/** Sentinel-1 collection filter defaults (Flood_D:1688–1694). */
const S1_COLLECTION_DEFAULTS = Object.freeze({
    instrumentMode: 'IW',
    polarisations: ['VV', 'VH'],
    resolutionMeters: 10,
});

// ── Pure helpers ────────────────────────────────────────────────────────────

/**
 * dB → linear power ratio (10^(dB/10)). Reference: `toNatural` at
 * floodTrend_ft_final.js:886 / Flood_D_final.js:1588.
 *
 * The output preserves image properties so downstream `.select` / filter
 * chains keep working.
 */
function toNatural(ee, image) {
    if (!ee) {
        throw new Error('sentinel1.toNatural requires the ee module');
    }
    if (!image) {
        throw new Error('sentinel1.toNatural requires an image');
    }
    return ee
        .Image(10)
        .pow(image.divide(10))
        .copyProperties(image, [
            'system:time_start',
            'orbitProperties_pass',
            'relativeOrbitNumber_start',
        ]);
}

/**
 * Drop pixels outside the valid Sentinel-1 IW acquisition envelope
 * (Flood_D:1597–1631). Values are locked; do not raise VV/VH caps without
 * §15 evidence — extreme values are ambient artefacts, not real backscatter.
 */
function maskS1Edges(ee, image) {
    if (!ee) {
        throw new Error('sentinel1.maskS1Edges requires the ee module');
    }
    if (!image) {
        throw new Error('sentinel1.maskS1Edges requires an image');
    }

    const angle = image.select('angle');
    const angleMask = angle.gte(INCIDENCE_ANGLE_MIN_DEG).and(angle.lte(INCIDENCE_ANGLE_MAX_DEG));

    const vv = image.select('VV');
    const vh = image.select('VH');
    const vvMask = vv.gte(VV_MIN_DB).and(vv.lte(VV_MAX_DB));
    const vhMask = vh.gte(VH_MIN_DB).and(vh.lte(VH_MAX_DB));

    return image.updateMask(angleMask).updateMask(vvMask).updateMask(vhMask);
}

/**
 * Focal-median speckle filter over VV + VH with a `SPECKLE_RADIUS_M` kernel
 * (Flood_D:1633–1660). Preserves the incidence angle band untouched — the
 * classifier still wants the raw angle for QA.
 */
function filterSpeckle(ee, image, { radiusMeters = SPECKLE_RADIUS_M } = {}) {
    if (!ee) {
        throw new Error('sentinel1.filterSpeckle requires the ee module');
    }
    if (!image) {
        throw new Error('sentinel1.filterSpeckle requires an image');
    }
    // Flood_D keeps VV/VH/angle only; other bands are not consumed downstream.
    const vvSmoothed = image
        .select('VV')
        .focal_median(radiusMeters, 'circle', 'meters')
        .rename('VV');
    const vhSmoothed = image
        .select('VH')
        .focal_median(radiusMeters, 'circle', 'meters')
        .rename('VH');
    return vvSmoothed
        .addBands(vhSmoothed)
        .addBands(image.select('angle'))
        .copyProperties(image, [
            'system:time_start',
            'orbitProperties_pass',
            'relativeOrbitNumber_start',
        ]);
}

/**
 * Stamp `orbit_key = "<pass>_<relOrbit>"` on each image so the orbit picker
 * can group + dedupe candidates in a single reduce (Flood_D:1662–1680).
 */
function addOrbitKey(ee, image) {
    if (!ee) {
        throw new Error('sentinel1.addOrbitKey requires the ee module');
    }
    if (!image) {
        throw new Error('sentinel1.addOrbitKey requires an image');
    }
    const pass = image.get('orbitProperties_pass');
    const relOrbit = image.get('relativeOrbitNumber_start');
    return image.set('orbit_key', ee.String(pass).cat('_').cat(ee.Number(relOrbit).format('%d')));
}

/**
 * Fetch a filtered Sentinel-1 GRD collection ready for the pipeline.
 * Applies IW-mode + dual-polarisation + edge-masking + speckle + orbit key.
 *
 * @param {object} ee
 * @param {object} args
 * @param {string} args.start   — ISO date (YYYY-MM-DD)
 * @param {string} args.end     — ISO date (YYYY-MM-DD; exclusive per GEE)
 * @param {object} args.aoi     — ee.Geometry (from geometry.loadAoi)
 * @param {'AUTO'|'ASCENDING'|'DESCENDING'} [args.pass='AUTO']
 * @param {number} [args.relativeOrbit] — filter by exact relative orbit
 * @returns {object} ee.ImageCollection
 */
function getS1Collection(ee, { start, end, aoi, pass = 'AUTO', relativeOrbit } = {}) {
    if (!ee) {
        throw new Error('sentinel1.getS1Collection requires the ee module');
    }
    if (!start || !end) {
        throw new Error('sentinel1.getS1Collection requires start + end');
    }
    if (!aoi) {
        throw new Error('sentinel1.getS1Collection requires an aoi geometry');
    }

    // The API accepts inclusive calendar windows; Earth Engine's filterDate
    // treats the end as exclusive.
    const exclusiveEnd = ee.Date(end).advance(1, 'day');
    let collection = ee
        .ImageCollection(ASSETS.SENTINEL1_GRD)
        .filterBounds(aoi)
        .filterDate(start, exclusiveEnd)
        .filter(ee.Filter.eq('instrumentMode', S1_COLLECTION_DEFAULTS.instrumentMode))
        .filter(ee.Filter.eq('resolution_meters', S1_COLLECTION_DEFAULTS.resolutionMeters))
        .filter(ee.Filter.listContains('transmitterReceiverPolarisation', 'VV'))
        .filter(ee.Filter.listContains('transmitterReceiverPolarisation', 'VH'))
        .select(['VV', 'VH', 'angle']);

    if (pass && pass !== 'AUTO') {
        collection = collection.filter(ee.Filter.eq('orbitProperties_pass', pass));
    }
    if (Number.isFinite(relativeOrbit)) {
        collection = collection.filter(ee.Filter.eq('relativeOrbitNumber_start', relativeOrbit));
    }

    return collection
        .map((img) => maskS1Edges(ee, img))
        .map((img) => filterSpeckle(ee, img))
        .map((img) => addOrbitKey(ee, img));
}

module.exports = {
    // Locked constants
    SPECKLE_RADIUS_M,
    INCIDENCE_ANGLE_MIN_DEG,
    INCIDENCE_ANGLE_MAX_DEG,
    VV_MIN_DB,
    VV_MAX_DB,
    VH_MIN_DB,
    VH_MAX_DB,
    S1_COLLECTION_DEFAULTS,
    // Primitives
    toNatural,
    maskS1Edges,
    filterSpeckle,
    addOrbitKey,
    getS1Collection,
};
