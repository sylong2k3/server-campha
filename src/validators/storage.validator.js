'use strict';

const Joi = require('joi');

const CATEGORIES = ['layers', 'raster', 'documents', 'field-photos'];
const presignSchema = Joi.object({
    category: Joi.string()
        .valid(...CATEGORIES)
        .required(),
    originalName: Joi.string().trim().min(1).max(255).required(),
    contentType: Joi.string().trim().max(150).required(),
    expireSeconds: Joi.number().integer().min(60).max(3600).default(900),
});
const directUploadHeadersSchema = Joi.object({
    'x-file-category': Joi.string()
        .valid(...CATEGORIES)
        .required(),
    'x-file-name': Joi.string().trim().min(1).max(255).required(),
    'content-type': Joi.string().trim().max(150).required(),
    'content-length': Joi.number().integer().positive().required(),
}).unknown(true);
const objectIdParamsSchema = Joi.object({
    id: Joi.number().integer().positive().required(),
});
const downloadQuerySchema = Joi.object({
    expireSeconds: Joi.number().integer().min(60).max(3600).default(900),
});
module.exports = {
    CATEGORIES,
    presignSchema,
    directUploadHeadersSchema,
    objectIdParamsSchema,
    downloadQuerySchema,
};
