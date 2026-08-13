'use strict';

const { ee } = require('../../../configs/gge');
const { Api400Error } = require('../../../core/error.response');

// ST_B10 is the surface-temperature product from Landsat Collection 2 Level 2.
// The thermal sensor's native ground sampling distance is about 100 m; USGS
// distributes it on the 30 m Landsat grid. This is substantially more detailed
// than the former 1 km MODIS product, without claiming resampling creates new
// 30 m thermal observations.
const LANDSAT_THERMAL_COLLECTIONS = Object.freeze({
    L8: 'LANDSAT/LC08/C02/T1_L2',
    L9: 'LANDSAT/LC09/C02/T1_L2',
});
const NATIVE_THERMAL_RESOLUTION_METERS = 100;
const OUTPUT_RESOLUTION_METERS = 30;

const HEATMAP_LEGEND = Object.freeze([
    { value: 20, label: 'Mát', color: '#313695' },
    { value: 28, label: 'Trung bình', color: '#74add1' },
    { value: 35, label: 'Ấm', color: '#fd8d3c' },
    { value: 45, label: 'Nóng', color: '#d73027' },
]);

const resolveThermalSources = (collection) => {
    switch (collection) {
        case 'L8':
            return ['L8'];
        case 'L9':
            return ['L9'];
        case 'LANDSAT':
        case 'S2':
        case 'AUTO':
        default:
            // Sentinel-2 has no thermal band. AUTO and S2 therefore use both
            // Landsat missions instead of silently producing an empty result.
            return ['L8', 'L9'];
    }
};

const maskThermalLandsat = (image) => {
    const qa = image.select('QA_PIXEL');
    const clearMask = qa
        .bitwiseAnd(1 << 0) // Fill
        .eq(0)
        .and(qa.bitwiseAnd(1 << 1).eq(0)) // Dilated cloud
        .and(qa.bitwiseAnd(1 << 3).eq(0)) // Cloud
        .and(qa.bitwiseAnd(1 << 4).eq(0)) // Cloud shadow
        .and(qa.bitwiseAnd(1 << 5).eq(0)); // Snow

    // Landsat Collection 2 scale and offset for ST_B10: Kelvin -> Celsius.
    return image
        .updateMask(clearMask)
        .select('ST_B10')
        .multiply(0.00341802)
        .add(149)
        .subtract(273.15)
        .rename('LST_C')
        .toFloat();
};

const sourceCollection = (source, params, region) =>
    ee
        .ImageCollection(LANDSAT_THERMAL_COLLECTIONS[source])
        .filterBounds(region)
        .filterDate(params.startDate, params.endDate)
        .filter(ee.Filter.lte('CLOUD_COVER', params.cloudCover))
        .map(maskThermalLandsat);

const buildThermalCollection = (params, region) =>
    resolveThermalSources(params.collection).reduce(
        (combined, source) => combined.merge(sourceCollection(source, params, region)),
        ee.ImageCollection([]),
    );

const buildHeatmap = async (params, region, { evaluate }) => {
    const collection = buildThermalCollection(params, region);
    const imageCount = Number(await evaluate(collection.size()));
    if (!Number.isFinite(imageCount) || imageCount <= 0) {
        throw new Api400Error('Không tìm thấy ảnh nhiệt Landsat đạt điều kiện mây cho khoảng thời gian và khu vực đã chọn.', [
            'SATELLITE_IMAGE_NOT_FOUND',
        ]);
    }

    const image = collection.median().rename('LST_C').clip(region);
    const summary = await evaluate(
        image.reduceRegion({
            reducer: ee.Reducer.mean().combine({ reducer2: ee.Reducer.minMax(), sharedInputs: true }),
            geometry: region,
            scale: OUTPUT_RESOLUTION_METERS,
            maxPixels: 1e13,
            bestEffort: true,
        }),
    );
    const numberOrNull = (value) => (Number.isFinite(Number(value)) ? Number(value) : null);
    const sources = resolveThermalSources(params.collection);

    return {
        image,
        viz: { min: 20, max: 45, palette: ['#313695', '#74add1', '#fed976', '#fd8d3c', '#d73027'] },
        region,
        stats: {
            imageCount,
            meanC: numberOrNull(summary?.LST_C_mean),
            minC: numberOrNull(summary?.LST_C_min),
            maxC: numberOrNull(summary?.LST_C_max),
        },
        legend: HEATMAP_LEGEND,
        metadata: {
            source: sources.map((source) => LANDSAT_THERMAL_COLLECTIONS[source]),
            geometrySource: params.geometrySource,
            dateInterval: `[${params.startDate}, ${params.endDate})`,
            resolutionMeters: OUTPUT_RESOLUTION_METERS,
            nativeResolutionMeters: NATIVE_THERMAL_RESOLUTION_METERS,
            resolutionNote:
                'Băng nhiệt Landsat đo ở độ phân giải gốc khoảng 100 m và được USGS phân phối trên lưới 30 m; lưới 30 m không làm tăng chi tiết đo nhiệt thực tế.',
            cloudFilter: 'Landsat Collection 2: CLOUD_COVER ≤ ngưỡng yêu cầu, đồng thời loại mây, bóng mây, tuyết và pixel rỗng bằng QA_PIXEL.',
            cloudCover: params.cloudCover,
        },
    };
};

module.exports = {
    HEATMAP_LEGEND,
    LANDSAT_THERMAL_COLLECTIONS,
    NATIVE_THERMAL_RESOLUTION_METERS,
    OUTPUT_RESOLUTION_METERS,
    buildHeatmap,
    buildThermalCollection,
    maskThermalLandsat,
    resolveThermalSources,
};
