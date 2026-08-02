'use strict';

const Joi = require('joi');
const platforms = ['sentinel-1', 'sentinel-2', 'landsat-7', 'landsat-8'];
const id = Joi.number().integer().positive();
const date = Joi.date().iso();
const listSchema = Joi.object({
    q: Joi.string().trim().max(100),
    platform: Joi.string().valid(...platforms),
    thematicGroup: Joi.string().trim().max(80),
    from: date,
    to: date.min(Joi.ref('from')),
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(20),
    sort: Joi.string().valid('acquiredAt:asc', 'acquiredAt:desc').default('acquiredAt:desc'),
});
const createSchema = Joi.object({
    sceneCode: Joi.string().trim().max(150).required(),
    title: Joi.string().trim().max(300).required(),
    platform: Joi.string()
        .valid(...platforms)
        .required(),
    thematicGroup: Joi.string().trim().max(80).allow(null, ''),
    coverageKey: Joi.string()
        .pattern(/^[a-z0-9][a-z0-9_-]{1,119}$/)
        .required(),
    acquiredAt: date.required(),
    productLevel: Joi.string().trim().max(50).allow(null, ''),
    resolutionM: Joi.number().positive().max(999999),
    cloudCoverPercent: Joi.number().min(0).max(100),
    orbitNumber: Joi.number().integer().positive(),
    description: Joi.string().trim().max(5000).allow(null, ''),
    fileObjectId: id.required(),
});
const categorySchema = Joi.object({
    thematicGroup: Joi.string().trim().min(1).max(80).required(),
    expectedUpdatedAt: date.required(),
});
const idParamsSchema = Joi.object({ id: id.required() });
const compareSchema = Joi.object({
    beforeId: id.required(),
    afterId: id.invalid(Joi.ref('beforeId')).required(),
});
const deleteQuerySchema = Joi.object({ expectedUpdatedAt: date.required() });
const downloadQuerySchema = Joi.object({
    expireSeconds: Joi.number().integer().min(60).max(900).default(300),
});
module.exports = {
    platforms,
    listSchema,
    createSchema,
    categorySchema,
    idParamsSchema,
    compareSchema,
    deleteQuerySchema,
    downloadQuerySchema,
};
