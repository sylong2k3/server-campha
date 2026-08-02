'use strict';

const Joi = require('joi');
const layerIdParamsSchema = Joi.object({ layerId: Joi.number().integer().positive().required() });
const wmsQuerySchema = Joi.object({
    request: Joi.string().valid('GetMap').insensitive().required(),
    bbox: Joi.string()
        .pattern(/^-?\d+(\.\d+)?,-?\d+(\.\d+)?,-?\d+(\.\d+)?,-?\d+(\.\d+)?$/)
        .required(),
    width: Joi.number().integer().min(1).max(4096).required(),
    height: Joi.number().integer().min(1).max(4096).required(),
    crs: Joi.string().valid('EPSG:4326', 'EPSG:5899').default('EPSG:4326'),
    format: Joi.string().valid('image/png', 'image/jpeg').default('image/png'),
    transparent: Joi.boolean().default(true),
    version: Joi.string().valid('1.3.0').default('1.3.0'),
});
const wfsQuerySchema = Joi.object({
    request: Joi.string().valid('GetFeature').insensitive().required(),
    bbox: Joi.string()
        .pattern(/^-?\d+(\.\d+)?,-?\d+(\.\d+)?,-?\d+(\.\d+)?,-?\d+(\.\d+)?$/)
        .optional(),
    count: Joi.number().integer().min(1).max(10000).default(1000),
    srsName: Joi.string().valid('EPSG:4326', 'EPSG:5899').default('EPSG:4326'),
    outputFormat: Joi.string().valid('application/json').default('application/json'),
});
module.exports = { layerIdParamsSchema, wmsQuerySchema, wfsQuerySchema };
