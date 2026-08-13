'use strict';

const { ee } = require('../../configs/gge');
const { nextDay } = require('./request');

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
        .filterDate(startDate, nextDay(endDate))
        .filter(ee.Filter.lte('CLOUDY_PIXEL_PERCENTAGE', cloudCover))
        .map(mask)
        .median()
        .clip(region);
};

const landsatComposite = ({ startDate, endDate, cloudCover }, region, withThermal = false) => {
    const mask = (image) => {
        const qa = image.select('QA_PIXEL');
        const optical = image
            .updateMask(qa.bitwiseAnd(1 << 3).eq(0))
            .updateMask(qa.bitwiseAnd(1 << 4).eq(0))
            .select(['SR_B2', 'SR_B3', 'SR_B4', 'SR_B5'], ['blue', 'green', 'red', 'nir'])
            .multiply(0.0000275)
            .add(-0.2);
        return withThermal
            ? optical.addBands(
                  image
                      .select('ST_B10')
                      .multiply(0.00341802)
                      .add(149)
                      .subtract(273.15)
                      .rename('lst'),
              )
            : optical;
    };
    const create = (id) =>
        ee
            .ImageCollection(id)
            .filterBounds(region)
            .filterDate(startDate, nextDay(endDate))
            .filter(ee.Filter.lte('CLOUD_COVER', cloudCover));
    return create('LANDSAT/LC08/C02/T1_L2')
        .merge(create('LANDSAT/LC09/C02/T1_L2'))
        .map(mask)
        .median()
        .clip(region);
};

const opticalComposite = (params, region) =>
    params.collection === 'S2' || (params.collection === 'AUTO' && params.startDate >= '2017-01-01')
        ? sentinelComposite(params, region)
        : landsatComposite(params, region);

const buildImage = (params) => {
    const region = toEeGeometry(params.geometry);
    if (params.type === 'rgb') {
        return {
            image: opticalComposite(params, region),
            viz: { bands: ['red', 'green', 'blue'], min: 0, max: 0.3 },
            region,
        };
    }
    if (params.type === 'ndvi') {
        return {
            image: opticalComposite(params, region)
                .normalizedDifference(['nir', 'red'])
                .rename('ndvi'),
            viz: { min: -0.2, max: 0.9, palette: ['#a6611a', '#dfc27d', '#80cdc1', '#01665e'] },
            region,
        };
    }
    if (params.type === 'heatmap') {
        return {
            image: landsatComposite(params, region, true).select('lst'),
            viz: { min: 20, max: 42, palette: ['#313695', '#74add1', '#fdae61', '#a50026'] },
            region,
        };
    }
    const optical = opticalComposite(params, region);
    const ndvi = optical.normalizedDifference(['nir', 'red']).rename('ndvi');
    if (params.type === 'classified') {
        const image = ee
            .Image(0)
            .where(ndvi.gte(0.2), 1)
            .where(ndvi.gte(0.45), 2)
            .where(ndvi.gte(0.65), 3)
            .rename('class');
        return {
            image,
            viz: { min: 0, max: 3, palette: ['#2c7bb6', '#fdae61', '#abdda4', '#1a9850'] },
            region,
        };
    }
    const temperature = landsatComposite(params, region, true).select('lst').unitScale(20, 42);
    const dryness = ee.Image(1).subtract(ndvi.unitScale(-0.2, 0.8));
    const risk = dryness.multiply(0.65).add(temperature.multiply(0.35));
    const image = ee
        .Image(0)
        .where(risk.gte(0.35), 1)
        .where(risk.gte(0.6), 2)
        .where(risk.gte(0.8), 3)
        .rename('fire_risk');
    return {
        image,
        viz: { min: 0, max: 3, palette: ['#2c7bb6', '#fee08b', '#f46d43', '#a50026'] },
        region,
    };
};

module.exports = { buildImage };
