'use strict';

const { ee } = require('../../../configs/gge');
const { Api400Error } = require('../../../core/error.response');

const SENTINEL_ID = 'COPERNICUS/S2_SR_HARMONIZED';
const LANDSAT_8_ID = 'LANDSAT/LC08/C02/T1_L2';
const LANDSAT_9_ID = 'LANDSAT/LC09/C02/T1_L2';

const NDVI_LEGEND = Object.freeze([
    { value: -0.2, label: 'Ít hoặc không có thực vật', color: '#d73027' },
    { value: 0.2, label: 'Thực vật thưa', color: '#fee08b' },
    { value: 0.5, label: 'Thực vật trung bình', color: '#ffffbf' },
    { value: 0.8, label: 'Thực vật dày', color: '#1a9641' },
]);

const resolveCollectionSources = (collection) => {
    switch (collection) {
        case 'S2':
            return ['S2'];
        case 'L8':
            return ['L8'];
        case 'L9':
            return ['L9'];
        case 'LANDSAT':
            return ['L8', 'L9'];
        case 'AUTO':
        default:
            // This is the legacy default: use every supported optical source,
            // rather than silently preferring Sentinel-2 after 2017.
            return ['L8', 'L9', 'S2'];
    }
};

const maskLandsatC2 = (image) => {
    const qa = image.select('QA_PIXEL');
    const clearMask = qa
        .bitwiseAnd(1 << 0)
        .eq(0)
        .and(qa.bitwiseAnd(1 << 1).eq(0))
        .and(qa.bitwiseAnd(1 << 3).eq(0))
        .and(qa.bitwiseAnd(1 << 4).eq(0))
        .and(qa.bitwiseAnd(1 << 5).eq(0));

    return image
        .updateMask(clearMask)
        .select(['SR_B2', 'SR_B3', 'SR_B4', 'SR_B5'], ['blue', 'green', 'red', 'nir'])
        .multiply(0.0000275)
        .add(-0.2)
        .clamp(0, 1)
        .toFloat();
};

const maskSentinel2 = (image) => {
    const scl = image.select('SCL');
    const clearMask = scl
        .neq(3)
        .and(scl.neq(8))
        .and(scl.neq(9))
        .and(scl.neq(10))
        .and(scl.neq(11));

    return image
        .updateMask(clearMask)
        .select(['B2', 'B3', 'B4', 'B8'], ['blue', 'green', 'red', 'nir'])
        .multiply(0.0001)
        .clamp(0, 1)
        .toFloat();
};

const sourceCollection = (source, params, region) => {
    const base = (id) => ee.ImageCollection(id).filterBounds(region).filterDate(params.startDate, params.endDate);
    if (source === 'S2') {
        return base(SENTINEL_ID)
            .filter(ee.Filter.lte('CLOUDY_PIXEL_PERCENTAGE', params.cloudCover))
            .map(maskSentinel2);
    }
    return base(source === 'L8' ? LANDSAT_8_ID : LANDSAT_9_ID).map(maskLandsatC2);
};

const buildOpticalCollection = (params, region) =>
    resolveCollectionSources(params.collection).reduce(
        (combined, source) => combined.merge(sourceCollection(source, params, region)),
        ee.ImageCollection([]),
    );

const buildOpticalComposite = (params, region) => buildOpticalCollection(params, region).median().clip(region);

const assertHasImages = async (collection, evaluate) => {
    const count = Number(await evaluate(collection.size()));
    if (!Number.isFinite(count) || count <= 0) {
        throw new Api400Error('Không tìm thấy ảnh vệ tinh cho khoảng thời gian và khu vực đã chọn.', [
            'SATELLITE_IMAGE_NOT_FOUND',
        ]);
    }
    return count;
};

const baseMetadata = (params) => ({
    source: resolveCollectionSources(params.collection),
    geometrySource: params.geometrySource,
    dateInterval: `[${params.startDate}, ${params.endDate})`,
    cloudFilter: 'Sentinel-2: CLOUDY_PIXEL_PERCENTAGE + mặt nạ SCL; Landsat: QA_PIXEL Bộ sưu tập 2',
    cloudCover: params.cloudCover,
});

const buildRgb = async (params, region, { evaluate }) => {
    const collection = buildOpticalCollection(params, region);
    const imageCount = await assertHasImages(collection, evaluate);
    return {
        image: collection.select(['red', 'green', 'blue']).median().clip(region),
        viz: { bands: ['red', 'green', 'blue'], min: 0, max: 0.3 },
        region,
        stats: { imageCount },
        legend: [],
        metadata: baseMetadata(params),
    };
};

const vegetationHectares = async (ndvi, region, threshold, evaluate) => {
    const area = ee.Image.pixelArea()
        .divide(10000)
        .updateMask(ndvi.gt(threshold))
        .rename('areaHa');
    const result = await evaluate(
        area.reduceRegion({
            reducer: ee.Reducer.sum(),
            geometry: region,
            scale: 100,
            maxPixels: 1e13,
            bestEffort: true,
        }),
    );
    const value = Number(result?.areaHa);
    return Number.isFinite(value) ? Number(value.toFixed(2)) : 0;
};

const buildNdvi = async (params, region, { evaluate }) => {
    const collection = buildOpticalCollection(params, region);
    const imageCount = await assertHasImages(collection, evaluate);
    const image = collection.median().normalizedDifference(['nir', 'red']).rename('NDVI').clip(region);
    const vegetationHa = await vegetationHectares(image, region, params.ndviMinThresh, evaluate);
    return {
        image,
        viz: {
            min: -0.2,
            max: 0.8,
            palette: ['#d73027', '#fee08b', '#ffffbf', '#90ee90', '#1a9641'],
        },
        region,
        stats: { imageCount, vegetationHa, ndviThreshUsed: params.ndviMinThresh },
        legend: NDVI_LEGEND,
        metadata: baseMetadata(params),
    };
};

module.exports = {
    NDVI_LEGEND,
    buildNdvi,
    buildOpticalCollection,
    buildOpticalComposite,
    buildRgb,
    maskLandsatC2,
    maskSentinel2,
    resolveCollectionSources,
};
