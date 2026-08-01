'use strict';

const Joi = require('joi');

const layerIdParamsSchema = Joi.object({ layerId: Joi.number().integer().positive().required() });
const featureParamsSchema = layerIdParamsSchema.keys({
    featureId: Joi.alternatives().try(
        Joi.number().integer().min(0),
        Joi.string().trim().pattern(/^[A-Za-z0-9_-]{1,120}$/)
    ).required(),
});
const catalogQuerySchema = Joi.object({
    category: Joi.string().trim().max(50).optional(),
});
const featureQuerySchema = Joi.object({
    includeGeometry: Joi.boolean().default(false),
});
const featureSearchSchema = Joi.object({
    q: Joi.string().trim().min(2).max(100).required(),
    layerId: Joi.number().integer().positive().optional(),
    bbox: Joi.string().pattern(/^-?\d+(\.\d+)?,-?\d+(\.\d+)?,-?\d+(\.\d+)?,-?\d+(\.\d+)?$/).optional(),
    limit: Joi.number().integer().min(1).max(50).default(20),
});
const terrainUrlQuerySchema = Joi.object({
    expireSeconds: Joi.number().integer().min(60).max(900).default(300),
});

module.exports = {
    layerIdParamsSchema, featureParamsSchema, catalogQuerySchema,
    featureQuerySchema, featureSearchSchema, terrainUrlQuerySchema,
};
