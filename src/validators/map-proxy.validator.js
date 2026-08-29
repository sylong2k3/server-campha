'use strict';

const Joi = require('joi');
const layerIdParamsSchema = Joi.object({ layerId: Joi.number().integer().positive().required() });
const wmsQuerySchema = Joi.object({
    request: Joi.string().valid('GetMap').insensitive().required(),
    bbox: Joi.string()
        .pattern(/^-?\d+(\.\d+)?,-?\d+(\.\d+)?,-?\d+(\.\d+)?,-?\d+(\.\d+)?$/)
        .required(),
    width: Joi.number().integer().min(1).max(32768).required(),
    height: Joi.number().integer().min(1).max(32768).required(),
    crs: Joi.string().valid('EPSG:3857', 'EPSG:4326', 'EPSG:5899').default('EPSG:4326'),
    format: Joi.string().valid('image/png', 'image/jpeg').default('image/png'),
    transparent: Joi.boolean().default(true),
    version: Joi.string().valid('1.3.0').default('1.3.0'),
    time: Joi.string()
        .pattern(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
        .optional(),
    ticket: Joi.string().max(2000).optional(),
});
const wfsQuerySchema = Joi.object({
    request: Joi.string().valid('GetFeature').insensitive().required(),
    bbox: Joi.string()
        .pattern(/^-?\d+(\.\d+)?,-?\d+(\.\d+)?,-?\d+(\.\d+)?,-?\d+(\.\d+)?$/)
        .optional(),
    count: Joi.number().integer().min(1).max(1000000).default(50000),
    srsName: Joi.string().valid('EPSG:4326', 'EPSG:5899').default('EPSG:4326'),
    outputFormat: Joi.string().valid('application/json').default('application/json'),
    ticket: Joi.string().max(2000).optional(),
});
const wcsQuerySchema = Joi.object({
    request: Joi.string().valid('GetCoverage').insensitive().required(),
    format: Joi.string().valid('image/tiff').default('image/tiff'),
    ticket: Joi.string().max(2000).optional(),
});
const tileTicketQuerySchema = Joi.object({
    access: Joi.string().valid('view', 'export').default('view'),
});
module.exports = {
    layerIdParamsSchema,
    wmsQuerySchema,
    wfsQuerySchema,
    wcsQuerySchema,
    tileTicketQuerySchema,
};
