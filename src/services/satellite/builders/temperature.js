'use strict';

const { ee } = require('../../../configs/gge');
const { Api400Error } = require('../../../core/error.response');

// MODIS is intentionally the sole heat-map source. It is lower resolution
// (1 km) than Landsat, but its daily LST coverage is more reliable for the RG
// boundary and avoids blank/black tiles when Landsat ST_B10 is fully masked.
const MODIS_LST_ID = 'MODIS/061/MOD11A1';
const MODIS_RESOLUTION_METERS = 1000;

const HEATMAP_LEGEND = Object.freeze([
    { value: 20, label: 'Mát', color: '#313695' },
    { value: 28, label: 'Trung bình', color: '#74add1' },
    { value: 35, label: 'Ấm', color: '#fd8d3c' },
    { value: 45, label: 'Nóng', color: '#d73027' },
]);

const buildModisCollection = (params, region) =>
    ee
        .ImageCollection(MODIS_LST_ID)
        .filterBounds(region)
        .filterDate(params.startDate, params.endDate)
        .select('LST_Day_1km');

const numberOrNull = (value) => (Number.isFinite(Number(value)) ? Number(value) : null);

const buildHeatmap = async (params, region, { evaluate }) => {
    const collection = buildModisCollection(params, region);
    const imageCount = Number(await evaluate(collection.size()));
    if (!Number.isFinite(imageCount) || imageCount <= 0) {
        throw new Api400Error('Không tìm thấy ảnh nhiệt MODIS cho khoảng thời gian và khu vực đã chọn.', [
            'SATELLITE_IMAGE_NOT_FOUND',
        ]);
    }

    // MODIS LST_Day_1km scale is 0.02 Kelvin. Clipping first keeps pixels
    // outside the RG polygon masked in both the preview and downloaded GeoTIFF.
    const image = collection
        .mean()
        .multiply(0.02)
        .subtract(273.15)
        .rename('LST_C')
        .clip(region);
    const summary = await evaluate(
        image.reduceRegion({
            reducer: ee.Reducer.count()
                .combine({ reducer2: ee.Reducer.mean(), sharedInputs: true })
                .combine({ reducer2: ee.Reducer.minMax(), sharedInputs: true }),
            geometry: region,
            scale: MODIS_RESOLUTION_METERS,
            maxPixels: 1e13,
            bestEffort: true,
        }),
    );
    const meanC = numberOrNull(summary?.LST_C_mean);
    const minC = numberOrNull(summary?.LST_C_min);
    const maxC = numberOrNull(summary?.LST_C_max);

    return {
        image,
        viz: { min: 20, max: 45, palette: ['#313695', '#74add1', '#fed976', '#fd8d3c', '#d73027'] },
        region,
        stats: {
            imageCount,
            validPixelCount: numberOrNull(summary?.LST_C_count) || 0,
            meanC,
            minC,
            maxC,
            // Existing sidebar uses these keys.
            lstMeanC: meanC,
            lstMinC: minC,
            lstMaxC: maxC,
        },
        legend: HEATMAP_LEGEND,
        metadata: {
            source: MODIS_LST_ID,
            thermalSource: 'modis',
            geometrySource: params.geometrySource,
            dateInterval: `[${params.startDate}, ${params.endDate})`,
            resolutionMeters: MODIS_RESOLUTION_METERS,
            nativeResolutionMeters: MODIS_RESOLUTION_METERS,
            downloadScaleMeters: MODIS_RESOLUTION_METERS,
            resolutionNote: 'Ảnh nhiệt MODIS có độ phân giải 1 km và được cắt theo ranh giới RG Cẩm Phả.',
            cloudFilter: 'Sản phẩm nhiệt MODIS hằng ngày đã được kiểm soát chất lượng bởi nguồn dữ liệu.',
        },
    };
};

module.exports = {
    HEATMAP_LEGEND,
    MODIS_LST_ID,
    MODIS_RESOLUTION_METERS,
    buildHeatmap,
    buildModisCollection,
};
