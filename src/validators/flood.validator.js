'use strict';

const Joi = require('joi');

const moduleName = Joi.string().valid('event', 'hand', 'rain', 'impact', 'trend');
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

const simulationSchema = Joi.object({
    rainfall: Joi.number().required().min(0).messages({
        'any.required': 'Lượng mưa là thông số bắt buộc',
        'number.base': 'Lượng mưa phải là một số',
        'number.min': 'Lượng mưa không được âm',
    }),
    tide: Joi.number().optional().allow(null, '').default(null).messages({
        'number.base': 'Mực nước thủy triều phải là một số',
    }),
}).unknown(true);

module.exports = { listSchema, publicListSchema, submitSchema, idParamsSchema, simulationSchema };

