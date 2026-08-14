'use strict';

const fs = require('fs');
const path = require('path');

const CP_RG_GEOJSON_PATH = path.resolve(__dirname, '../../data/cp_rg.geojson');

const unwrapGeometry = (value) => {
    if (value?.type === 'Feature') {
        return value.geometry;
    }
    if (value?.type === 'FeatureCollection') {
        return value.features?.[0]?.geometry || null;
    }
    return value;
};

const loadCamPhaGeometry = () => {
    const raw = fs.readFileSync(CP_RG_GEOJSON_PATH, 'utf8');
    const geometry = unwrapGeometry(JSON.parse(raw));
    if (!['Polygon', 'MultiPolygon'].includes(geometry?.type)) {
        throw new Error(`Invalid Cam Pha boundary geometry: ${CP_RG_GEOJSON_PATH}`);
    }
    return geometry;
};

const CAM_PHA_GEOMETRY = loadCamPhaGeometry();

module.exports = { CAM_PHA_GEOMETRY, CP_RG_GEOJSON_PATH, unwrapGeometry };
