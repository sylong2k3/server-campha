'use strict';

const { ee } = require('../../configs/gge');
const { buildNdvi, buildRgb, resolveCollectionSources } = require('./builders/optical');
const { buildHeatmap } = require('./builders/temperature');
const { CLASS_DEFINITIONS, CLASSIFIED_VIZ, buildForestClassification } = require('../forest-classification/pipeline');

const CLASSIFIED_LEGEND = CLASS_DEFINITIONS;

const landsatThermalComposite = (params, region) => {
    const maskAndSelect = (image) => {
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
            .addBands(
                image
                    .select('ST_B10')
                    .multiply(0.00341802)
                    .add(149)
                    .subtract(273.15)
                    .rename('lst'),
            );
    };
    const collection = (id) =>
        ee
            .ImageCollection(id)
            .filterBounds(region)
            .filterDate(params.startDate, params.endDate)
            .filter(ee.Filter.lte('CLOUD_COVER', params.cloudCover));
    return collection('LANDSAT/LC08/C02/T1_L2')
        .merge(collection('LANDSAT/LC09/C02/T1_L2'))
        .map(maskAndSelect)
        .median()
        .clip(region);
};

const buildClassified = async (params, region, dependencies) => {
    const { image, imageCount, areaByClass, totalHa } = await buildForestClassification(
        params,
        region,
        dependencies,
    );
    return {
        image,
        viz: CLASSIFIED_VIZ,
        region,
        stats: { imageCount, areaByClass, totalHa },
        legend: CLASSIFIED_LEGEND,
        metadata: {
            source: resolveCollectionSources(params.collection),
            geometrySource: params.geometrySource,
        },
    };
};

const buildImage = async (params, dependencies = {}) => {
    const region = ee.Geometry(params.geometry);
    switch (params.type) {
        case 'rgb':
            return buildRgb(params, region, dependencies);
        case 'ndvi':
            return buildNdvi(params, region, dependencies);
        case 'heatmap':
            return buildHeatmap(params, region, dependencies);
        case 'classified':
            return buildClassified(params, region, dependencies);
        default:
            throw new Error(`Unsupported satellite image type: ${params.type}`);
    }
};

module.exports = {
    CLASSIFIED_LEGEND,
    buildImage,
    landsatThermalComposite,
};
