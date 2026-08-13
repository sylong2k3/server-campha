'use strict';

const fs = require('fs');
const path = require('path');
const { Api400Error } = require('../../core/error.response');
const { assertType } = require('./cache');

const DEFAULT_AOI = {
    type: 'Polygon',
    coordinates: [
        [
            [107.05, 20.75],
            [107.75, 20.75],
            [107.75, 21.35],
            [107.05, 21.35],
            [107.05, 20.75],
        ],
    ],
};

const toDate = (value, field) => {
    const text = String(value || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(Date.parse(`${text}T00:00:00Z`))) {
        throw new Api400Error(`${field} phải có định dạng YYYY-MM-DD.`, ['INVALID_DATE']);
    }
    return text;
};

const nextDay = (date) => {
    const value = new Date(`${date}T00:00:00Z`);
    value.setUTCDate(value.getUTCDate() + 1);
    return value.toISOString().slice(0, 10);
};

const unwrapGeometry = (value) => {
    if (value?.type === 'Feature') {
        return value.geometry;
    }
    if (value?.type === 'FeatureCollection') {
        return value.features?.[0]?.geometry || null;
    }
    return value;
};

const configuredAoi = () => {
    const source = String(process.env.FC_BOUNDARY_GEOJSON || '').trim();
    if (!source) {
        return DEFAULT_AOI;
    }
    try {
        const raw =
            source.startsWith('{') || source.startsWith('[')
                ? source
                : fs.readFileSync(path.resolve(process.cwd(), source), 'utf8');
        return unwrapGeometry(JSON.parse(raw)) || DEFAULT_AOI;
    } catch (error) {
        console.warn(`[SATELLITE] FC_BOUNDARY_GEOJSON cannot be loaded: ${error.message}`);
        return DEFAULT_AOI;
    }
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
    const geometry = unwrapGeometry(input) || configuredAoi();
    if (
        !['Polygon', 'MultiPolygon'].includes(geometry?.type) ||
        !validCoordinates(geometry.coordinates)
    ) {
        throw new Api400Error(
            'geometry phải là GeoJSON Polygon hoặc MultiPolygon trong phạm vi Cẩm Phả.',
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
        throw new Api400Error('startDate phải trước hoặc bằng endDate.', ['INVALID_DATE_RANGE']);
    }
    const cloudCover = Number(raw.cloudCover ?? 50);
    if (!Number.isFinite(cloudCover) || cloudCover < 0 || cloudCover > 100) {
        throw new Api400Error('cloudCover phải nằm trong khoảng 0–100.', ['INVALID_CLOUD_COVER']);
    }
    const collection = String(raw.collection || 'AUTO').toUpperCase();
    if (!['AUTO', 'S2', 'LANDSAT'].includes(collection)) {
        throw new Api400Error('collection chỉ nhận AUTO, S2 hoặc LANDSAT.', ['INVALID_COLLECTION']);
    }
    return {
        type,
        startDate,
        endDate,
        collection,
        cloudCover,
        geometry: resolveGeometry(raw.geometry),
    };
};

module.exports = { nextDay, normalizeRequest };
