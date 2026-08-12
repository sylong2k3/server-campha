'use strict';

/**
 * AOI (Area of Interest) loader for the flood domain.
 *
 * By default we use FAO GAUL 2015 level-2 to pick out Cẩm Phả township. This
 * boundary is a decade out of date (§13 provenance) so we tag every run with
 * `aoi_source = 'REFERENCE_GAUL'` per architecture doc §82. When Sở TNMT
 * publishes an authoritative 2024/2025 geometry, wire it in via
 * `loadAoi({ authoritativeGeoJson })`.
 *
 * The `ee` module is passed in (not require'd here) so tests can supply a
 * fake and this file stays import-safe before Earth Engine is initialised.
 *
 * @source Flood_D_final.js:515 (FAO/GAUL/2015/level2 → 'Cam Pha Township')
 * @rule   architecture doc §82 (aoiSource must be recorded per run)
 */

const { ASSETS } = require('./datasets');
const { AOI_DEFAULTS } = require('../config/defaults');

/**
 * Values documented by GAUL for Cẩm Phả. The reference script filters by
 * ADM2_NAME only; adding ADM0 / ADM1 filters guards against homonyms in
 * other countries that GAUL sometimes carries.
 */
const CAM_PHA_GAUL_FILTER = Object.freeze({
    ADM0_NAME: 'Viet Nam',
    ADM1_NAME: 'Quang Ninh',
    ADM2_NAME: 'Cam Pha Township',
});

/**
 * Load the Cẩm Phả AOI as an ee.FeatureCollection.
 *
 * @param {object} ee — Earth Engine SDK (usually pass `require('@google/earthengine').ee`)
 * @param {object} [opts]
 * @param {object} [opts.gaulFilter] — override the default {ADM0,ADM1,ADM2} triplet
 * @param {object|string} [opts.authoritativeGeoJson] — GeoJSON polygon overriding
 *        GAUL. When provided, aoiSource() returns 'AUTHORITATIVE'.
 * @returns {{ fc: object, geometry: object, source: 'REFERENCE_GAUL'|'AUTHORITATIVE' }}
 */
function loadAoi(ee, opts = {}) {
    if (!ee) {
        throw new Error('geometry.loadAoi requires the ee module');
    }

    if (opts.authoritativeGeoJson) {
        const geo =
            typeof opts.authoritativeGeoJson === 'string'
                ? JSON.parse(opts.authoritativeGeoJson)
                : opts.authoritativeGeoJson;
        const geometry = ee.Geometry(geo);
        const fc = ee.FeatureCollection([ee.Feature(geometry)]);
        return { fc, geometry, source: 'AUTHORITATIVE' };
    }

    const filter = opts.gaulFilter || CAM_PHA_GAUL_FILTER;
    const collection = ee.FeatureCollection(ASSETS.FAO_GAUL_LEVEL2);
    const filters = Object.entries(filter).map(([key, value]) => ee.Filter.eq(key, value));
    const combined = filters.length === 1 ? filters[0] : ee.Filter.and.apply(null, filters);
    const fc = collection.filter(combined);
    // Union all matching admin polygons into one geometry (safe when the
    // filter matches a single row, still safe if multiple).
    const geometry = fc.geometry();
    return { fc, geometry, source: 'REFERENCE_GAUL' };
}

/**
 * Record the aoi_source enum value that goes on the flood_analysis_runs row.
 * Mirrors the migration CHECK constraint.
 */
const AOI_SOURCE = Object.freeze({
    REFERENCE_GAUL: 'REFERENCE_GAUL',
    AUTHORITATIVE: 'AUTHORITATIVE',
});

module.exports = {
    loadAoi,
    CAM_PHA_GAUL_FILTER,
    AOI_SOURCE,
    // Re-exported so run-metadata plumbing has one thing to import.
    DEFAULT_AOI_SOURCE: AOI_DEFAULTS.source,
};
