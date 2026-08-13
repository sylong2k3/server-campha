'use strict';

const { Api400Error } = require('../../core/error.response');
const { assertType } = require('./cache');
const { CAM_PHA_GEOMETRY, unwrapGeometry } = require('./geometry');

const COLLECTION_ALIASES = Object.freeze({
    AUTO: 'AUTO',
    S2: 'S2',
    SENTINEL2: 'S2',
    SENTINEL_2: 'S2',
    LANDSAT: 'LANDSAT',
    L8: 'L8',
    LANDSAT8: 'L8',
    LANDSAT_8: 'L8',
    L9: 'L9',
    LANDSAT9: 'L9',
    LANDSAT_9: 'L9',
});

const toDate = (value, field) => {
    const text = String(value || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(Date.parse(`${text}T00:00:00Z`))) {
        throw new Api400Error(`${field} must use YYYY-MM-DD format.`, ['INVALID_DATE']);
    }
    return text;
};

const normalizeCollection = (value) => {
    const input = String(value || 'AUTO').trim().toUpperCase().replace(/[ -]/g, '_');
    const collection = COLLECTION_ALIASES[input];
    if (!collection) {
        throw new Api400Error(
            'collection only accepts AUTO, S2, LANDSAT, L8, or L9.',
            ['INVALID_COLLECTION'],
        );
    }
    return collection;
};

const normalizeNdviThreshold = (value) => {
    const threshold = Number(value ?? 0.3);
    if (!Number.isFinite(threshold) || threshold < -1 || threshold > 1) {
        throw new Api400Error('ndviMinThresh must be between -1 and 1.', [
            'INVALID_NDVI_THRESHOLD',
        ]);
    }
    return threshold;
};

const validCoordinates = (coordinates) => {
    if (!Array.isArray(coordinates)) {
        return false;
    }
    if (coordinates.length >= 2 && coordinates.every((item) => typeof item === 'number')) {
        return (
            coordinates[0] >= 106 &&
            coordinates[0] <= 109 &&
            coordinates[1] >= 20 &&
            coordinates[1] <= 22.5
        );
    }
    return coordinates.length > 0 && coordinates.every(validCoordinates);
};

const resolveGeometry = (input) => {
    const geometry = unwrapGeometry(input) || CAM_PHA_GEOMETRY;
    if (
        !['Polygon', 'MultiPolygon'].includes(geometry?.type) ||
        !validCoordinates(geometry.coordinates)
    ) {
        throw new Api400Error(
            'geometry must be a GeoJSON Polygon or MultiPolygon within Cam Pha.',
            ['INVALID_GEOMETRY'],
        );
    }
    return geometry;
};

const normalizeRequest = (imageType, raw = {}) => {
    const type = assertType(imageType);
    const endDate = toDate(raw.endDate || raw.analysisDate, 'endDate');
    const startDate = toDate(raw.startDate || endDate, 'startDate');
    if (startDate > endDate) {
        throw new Api400Error('startDate must be before or equal to endDate.', ['INVALID_DATE_RANGE']);
    }
    const cloudCover = Number(raw.cloudCover ?? 50);
    if (!Number.isFinite(cloudCover) || cloudCover < 0 || cloudCover > 100) {
        throw new Api400Error('cloudCover must be between 0 and 100.', ['INVALID_CLOUD_COVER']);
    }

    // Earth Engine filterDate uses an exclusive end bound, as in the legacy API.
    return {
        type,
        startDate,
        endDate,
        collection: normalizeCollection(raw.collection),
        cloudCover,
        ndviMinThresh: normalizeNdviThreshold(raw.ndviMinThresh),
        geometry: resolveGeometry(raw.geometry),
        geometrySource: raw.geometry ? 'request' : 'cp_rg.geojson',
    };
};

module.exports = {
    DEFAULT_AOI: CAM_PHA_GEOMETRY,
    normalizeCollection,
    normalizeNdviThreshold,
    normalizeRequest,
};
