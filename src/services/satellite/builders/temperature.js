'use strict';

const { ee } = require('../../../configs/gge');
const { Api400Error } = require('../../../core/error.response');

const MODIS_LST_ID = 'MODIS/061/MOD11A1';
const HEATMAP_LEGEND = Object.freeze([
    { value: 20, label: 'Cool', color: '#313695' },
    { value: 28, label: 'Average', color: '#74add1' },
    { value: 35, label: 'Warm', color: '#fd8d3c' },
    { value: 45, label: 'Hot', color: '#d73027' },
]);

const buildHeatmap = async (params, region, { evaluate }) => {
    const collection = ee
        .ImageCollection(MODIS_LST_ID)
        .filterBounds(region)
        .filterDate(params.startDate, params.endDate)
        .select('LST_Day_1km');
    const imageCount = Number(await evaluate(collection.size()));
    if (!Number.isFinite(imageCount) || imageCount <= 0) {
        throw new Api400Error('No MODIS temperature image was found for the selected period and area.', [
            'SATELLITE_IMAGE_NOT_FOUND',
        ]);
    }

    const image = collection.mean().multiply(0.02).subtract(273.15).rename('LST_C').clip(region);
    const summary = await evaluate(
        image.reduceRegion({
            reducer: ee.Reducer.mean().combine({ reducer2: ee.Reducer.minMax(), sharedInputs: true }),
            geometry: region,
            scale: 1000,
            maxPixels: 1e13,
            bestEffort: true,
        }),
    );
    const numberOrNull = (value) => (Number.isFinite(Number(value)) ? Number(value) : null);

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
            source: MODIS_LST_ID,
            geometrySource: params.geometrySource,
            dateInterval: `[${params.startDate}, ${params.endDate})`,
            resolutionMeters: 1000,
            cloudFilter: 'Not applicable: MODIS daily LST is quality-screened by the product.',
        },
    };
};

module.exports = { HEATMAP_LEGEND, MODIS_LST_ID, buildHeatmap };
