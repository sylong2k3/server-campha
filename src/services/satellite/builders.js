'use strict';

const { ee } = require('../../configs/gge');
const { buildNdvi, buildOpticalComposite, buildRgb, resolveCollectionSources } = require('./builders/optical');
const { buildHeatmap } = require('./builders/temperature');
const { CLASS_DEFINITIONS, CLASSIFIED_VIZ, buildForestClassification } = require('../forest-classification/pipeline');

const CLASSIFIED_LEGEND = CLASS_DEFINITIONS;

const FIRE_RISK_LEGEND = Object.freeze([
    { value: 0, label: 'Low', color: '#2c7bb6' },
    { value: 1, label: 'Medium', color: '#fee08b' },
    { value: 2, label: 'High', color: '#f46d43' },
    { value: 3, label: 'Very high', color: '#a50026' },
]);

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

const buildFireRisk = (params, region) => {
    const optical = buildOpticalComposite(params, region);
    const ndvi = optical.normalizedDifference(['nir', 'red']).rename('ndvi');
    const temperature = landsatThermalComposite(params, region).select('lst').unitScale(20, 42);
    const dryness = ee.Image(1).subtract(ndvi.unitScale(-0.2, 0.8));
    const risk = dryness.multiply(0.65).add(temperature.multiply(0.35));
    return {
        image: ee
            .Image(0)
            .where(risk.gte(0.35), 1)
            .where(risk.gte(0.6), 2)
            .where(risk.gte(0.8), 3)
            .rename('fire_risk')
            .clip(region),
        viz: { min: 0, max: 3, palette: ['#2c7bb6', '#fee08b', '#f46d43', '#a50026'] },
        region,
        stats: {},
        legend: FIRE_RISK_LEGEND,
        metadata: { source: 'LANDSAT_C2_L2', geometrySource: params.geometrySource },
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
        case 'fire-risk':
            return buildFireRisk(params, region);
        default:
            throw new Error(`Unsupported satellite image type: ${params.type}`);
    }
};

module.exports = {
    CLASSIFIED_LEGEND,
    FIRE_RISK_LEGEND,
    buildImage,
    landsatThermalComposite,
};
