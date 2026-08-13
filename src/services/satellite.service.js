'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { ee } = require('../configs/gge');
const gee = require('./gee-earth-engine.adapter');
const repo = require('../repositories/satellite.repository');
const { Api400Error, Api404Error } = require('../core/error.response');

const DEFAULT_AOI = {
    type: 'Polygon',
    coordinates: [[[107.05, 20.75], [107.75, 20.75], [107.75, 21.35], [107.05, 21.35], [107.05, 20.75]]],
};

const LEGENDS = {
    rgb: [],
    ndvi: [
        { value: -1, label: 'Ít thực vật', color: '#a6611a' },
        { value: 0.2, label: 'Thực vật thưa', color: '#dfc27d' },
        { value: 0.5, label: 'Thực vật', color: '#80cdc1' },
        { value: 0.8, label: 'Thực vật dày', color: '#01665e' },
    ],
    heatmap: [
        { value: 20, label: 'Mát', color: '#313695' },
        { value: 28, label: 'Trung bình', color: '#74add1' },
        { value: 34, label: 'Nóng', color: '#fdae61' },
        { value: 40, label: 'Rất nóng', color: '#a50026' },
    ],
    classified: [
        { value: 0, label: 'Mặt nước / đất trống', color: '#2c7bb6' },
        { value: 1, label: 'Thảm thực vật thưa', color: '#fdae61' },
        { value: 2, label: 'Thảm thực vật', color: '#abdda4' },
        { value: 3, label: 'Rừng / thực vật dày', color: '#1a9850' },
    ],
    'fire-risk': [
        { value: 0, label: 'Thấp', color: '#2c7bb6' },
        { value: 1, label: 'Trung bình', color: '#fee08b' },
        { value: 2, label: 'Cao', color: '#f46d43' },
        { value: 3, label: 'Rất cao', color: '#a50026' },
    ],
};

const normalType = (value) => {
    const key = String(value || '').toLowerCase();
    if (key === 'heat-map' || key === 'heat_map') {return 'heatmap';}
    if (key === 'fire_risk' || key === 'firerisk') {return 'fire-risk';}
    return key;
};

const stable = (value) => {
    if (Array.isArray(value)) {return `[${value.map(stable).join(',')}]`;}
    if (value && typeof value === 'object') {
        return `{${Object.keys(value)
            .sort()
            .map((key) => `${JSON.stringify(key)}:${stable(value[key])}`)
            .join(',')}}`;
    }
    return JSON.stringify(value);
};

const hashRequest = (value) => crypto.createHash('sha256').update(stable(value)).digest('hex');

const toDate = (value, field) => {
    const text = String(value || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(Date.parse(`${text}T00:00:00Z`))) {
        throw new Api400Error(`${field} phải có định dạng YYYY-MM-DD.`, ['INVALID_DATE']);
    }
    return text;
};

const plusOneDay = (date) => {
    const next = new Date(`${date}T00:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    return next.toISOString().slice(0, 10);
};

const unwrapGeoJson = (value) => {
    if (value?.type === 'Feature') {return value.geometry;}
    if (value?.type === 'FeatureCollection') {return value.features?.[0]?.geometry || null;}
    return value;
};

const configuredAoi = () => {
    const source = String(process.env.FC_BOUNDARY_GEOJSON || '').trim();
    if (!source) {return DEFAULT_AOI;}
    try {
        const raw = source.startsWith('{') || source.startsWith('[')
            ? source
            : fs.readFileSync(path.resolve(process.cwd(), source), 'utf8');
        return unwrapGeoJson(JSON.parse(raw)) || DEFAULT_AOI;
    } catch (error) {
        console.warn(`[SATELLITE] FC_BOUNDARY_GEOJSON cannot be loaded: ${error.message}`);
        return DEFAULT_AOI;
    }
};

const validateCoordinates = (coordinates) => {
    if (!Array.isArray(coordinates)) {return false;}
    if (coordinates.length >= 2 && coordinates.every((item) => typeof item === 'number')) {
        return coordinates[0] >= 106 && coordinates[0] <= 109 && coordinates[1] >= 20 && coordinates[1] <= 22.5;
    }
    return coordinates.length > 0 && coordinates.every(validateCoordinates);
};

const resolveGeometry = (input) => {
    const geometry = unwrapGeoJson(input) || configuredAoi();
    if (!['Polygon', 'MultiPolygon'].includes(geometry?.type) || !validateCoordinates(geometry.coordinates)) {
        throw new Api400Error('geometry phải là GeoJSON Polygon hoặc MultiPolygon trong phạm vi Cẩm Phả.', [
            'INVALID_GEOMETRY',
        ]);
    }
    return geometry;
};

const normalizeRequest = (imageType, raw = {}) => {
    const type = normalType(imageType);
    if (!Object.prototype.hasOwnProperty.call(LEGENDS, type)) {
        throw new Api400Error('Loại ảnh vệ tinh không hợp lệ.', ['INVALID_IMAGE_TYPE']);
    }
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

const toEeGeometry = (geometry) => ee.Geometry(geometry);

const sentinelComposite = ({ startDate, endDate, cloudCover }, region) => {
    const mask = (image) => {
        const qa = image.select('QA60');
        return image
            .updateMask(qa.bitwiseAnd(1 << 10).eq(0))
            .updateMask(qa.bitwiseAnd(1 << 11).eq(0))
            .select(['B2', 'B3', 'B4', 'B8'], ['blue', 'green', 'red', 'nir'])
            .multiply(0.0001)
            .copyProperties(image, ['system:time_start']);
    };
    return ee
        .ImageCollection('COPERNICUS/S2_SR_HARMONIZED')
        .filterBounds(region)
        .filterDate(startDate, plusOneDay(endDate))
        .filter(ee.Filter.lte('CLOUDY_PIXEL_PERCENTAGE', cloudCover))
        .map(mask)
        .median()
        .clip(region);
};

const landsatCollection = ({ startDate, endDate, cloudCover }, region, withThermal = false) => {
    const mask = (image) => {
        const qa = image.select('QA_PIXEL');
        const optical = image
            .updateMask(qa.bitwiseAnd(1 << 3).eq(0))
            .updateMask(qa.bitwiseAnd(1 << 4).eq(0))
            .select(['SR_B2', 'SR_B3', 'SR_B4', 'SR_B5'], ['blue', 'green', 'red', 'nir'])
            .multiply(0.0000275)
            .add(-0.2);
        return withThermal
            ? optical.addBands(image.select('ST_B10').multiply(0.00341802).add(149).subtract(273.15).rename('lst'))
            : optical;
    };
    const criteria = ee.Filter.lte('CLOUD_COVER', cloudCover);
    const create = (id) => ee.ImageCollection(id).filterBounds(region).filterDate(startDate, plusOneDay(endDate)).filter(criteria);
    return create('LANDSAT/LC08/C02/T1_L2').merge(create('LANDSAT/LC09/C02/T1_L2')).map(mask).median().clip(region);
};

const opticalComposite = (params, region) => {
    const useSentinel = params.collection === 'S2' || (params.collection === 'AUTO' && params.startDate >= '2017-01-01');
    return useSentinel ? sentinelComposite(params, region) : landsatCollection(params, region);
};

const buildImage = (params) => {
    const region = toEeGeometry(params.geometry);
    if (params.type === 'rgb') {
        return { image: opticalComposite(params, region), viz: { bands: ['red', 'green', 'blue'], min: 0, max: 0.3 }, region };
    }
    if (params.type === 'ndvi') {
        return {
            image: opticalComposite(params, region).normalizedDifference(['nir', 'red']).rename('ndvi'),
            viz: { min: -0.2, max: 0.9, palette: ['#a6611a', '#dfc27d', '#80cdc1', '#01665e'] },
            region,
        };
    }
    if (params.type === 'heatmap') {
        return {
            image: landsatCollection(params, region, true).select('lst'),
            viz: { min: 20, max: 42, palette: ['#313695', '#74add1', '#fdae61', '#a50026'] },
            region,
        };
    }
    const optical = opticalComposite(params, region);
    const ndvi = optical.normalizedDifference(['nir', 'red']).rename('ndvi');
    if (params.type === 'classified') {
        const image = ee.Image(0).where(ndvi.gte(0.2), 1).where(ndvi.gte(0.45), 2).where(ndvi.gte(0.65), 3).rename('class');
        return { image, viz: { min: 0, max: 3, palette: ['#2c7bb6', '#fdae61', '#abdda4', '#1a9850'] }, region };
    }
    const temperature = landsatCollection(params, region, true).select('lst').unitScale(20, 42);
    const dryness = ee.Image(1).subtract(ndvi.unitScale(-0.2, 0.8));
    const risk = dryness.multiply(0.65).add(temperature.multiply(0.35));
    const image = ee.Image(0).where(risk.gte(0.35), 1).where(risk.gte(0.6), 2).where(risk.gte(0.8), 3).rename('fire_risk');
    return { image, viz: { min: 0, max: 3, palette: ['#2c7bb6', '#fee08b', '#f46d43', '#a50026'] }, region };
};

const toResponse = (row, cached) => ({
    resultId: row.id,
    geeTileUrl: row.tile_url,
    geoserverLayer: row.geoserver_layer || null,
    downloadUrl: row.metadata?.downloadUrl || null,
    downloadFilename: row.metadata?.downloadFilename || null,
    stats: row.stats || {},
    legend: row.legend || [],
    metadata: row.metadata || {},
    cached,
});

async function processRequest(imageType, rawParams) {
    const params = normalizeRequest(imageType, rawParams);
    const requestHash = hashRequest(params);
    const cached = await repo.getByHash(requestHash);
    if (cached) {return toResponse(cached, true);}

    const { image, viz, region } = buildImage(params);
    const map = await gee.getMapId(image, viz);
    const downloadUrl = await gee
        .getDownloadUrl(image, { name: `satellite_${params.type}_${params.startDate}`, region, scale: 30, filePerBand: false })
        .catch(() => null);
    const metadata = {
        collection: params.collection,
        source: params.type === 'heatmap' || params.type === 'fire-risk' ? 'LANDSAT_C2_L2' : params.collection,
        generatedAt: new Date().toISOString(),
        downloadUrl,
        downloadFilename: downloadUrl ? `satellite_${params.type}_${params.startDate}.zip` : null,
    };
    const row = await repo.upsert({
        requestHash,
        imageType: params.type,
        collection: params.collection,
        startDate: params.startDate,
        endDate: params.endDate,
        geometry: params.geometry,
        tileUrl: map.tileUrl,
        mapId: map.mapId,
        stats: {},
        legend: LEGENDS[params.type],
        metadata,
    });
    return toResponse(row, false);
}

async function enqueueRasterPublish(resultId, actor, lang) {
    const result = await repo.getById(resultId);
    if (!result) {throw new Api404Error('Kết quả ảnh vệ tinh không tồn tại hoặc đã hết hạn.', ['SATELLITE_RESULT_NOT_FOUND']);}
    if (result.geoserver_layer) {return { result, alreadyPublished: true };}
    const sourceUrl = result.metadata?.downloadUrl;
    if (!sourceUrl) {throw new Api400Error('Kết quả chưa có URL tải GeoTIFF để publish.', ['NO_DOWNLOAD_URL']);}
    const rasterIngest = require('./raster-ingest.service');
    const startTag = String(result.start_date).replace(/-/g, '');
    const layerCode = `satellite_${result.image_type}_${startTag}_${result.id}`.slice(0, 59);
    const { job, deduplicated } = await rasterIngest.enqueue({
        sourceUrl,
        layerCode,
        nameVi: `Ảnh vệ tinh ${result.image_type} ${result.start_date}`,
        category: 'satellite',
        isPublic: true,
        requestParams: { linkedResource: { type: 'satellite', id: result.id } },
        user: actor || null,
        lang,
    });
    return { result, job, deduplicated, layerCode, alreadyPublished: false };
}

module.exports = {
    processRequest,
    getRgb: (params) => processRequest('rgb', params),
    getNdvi: (params) => processRequest('ndvi', params),
    getHeatmap: (params) => processRequest('heatmap', params),
    getClassified: (params) => processRequest('classified', params),
    getFireRisk: (params) => processRequest('fire-risk', params),
    enqueueRasterPublish,
};
