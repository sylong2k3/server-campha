'use strict';

const Joi = require('joi');

const moduleName = Joi.string().valid('event', 'hand', 'rain', 'impact', 'trend', 'forecast');
const status = Joi.string().valid(
    'QUEUED',
    'COMPUTING',
    'EXPORTING',
    'HARVESTING',
    'VALIDATING',
    'ARCHIVING',
    'PUBLISHING',
    'SUCCEEDED',
    'FAILED',
    'CANCELLED',
    'DLQ',
);

const listSchema = Joi.object({
    module: moduleName,
    status,
    from: Joi.date().iso(),
    to: Joi.date().iso(),
    startedBy: Joi.number().integer().positive(),
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(20),
}).unknown(false);

const publicListSchema = Joi.object({
    module: moduleName,
    from: Joi.date().iso(),
    to: Joi.date().iso(),
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(20),
}).unknown(false);

const submitSchema = Joi.object({
    module: moduleName.required(),
    mode: Joi.string().valid('product', 'calibration').default('product'),
    config: Joi.object().unknown(true).default({}),
}).unknown(false);

const idParamsSchema = Joi.object({
    id: Joi.number().integer().positive().required(),
}).unknown(false);

module.exports = { listSchema, publicListSchema, submitSchema, idParamsSchema };
