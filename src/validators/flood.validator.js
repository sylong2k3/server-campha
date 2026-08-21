'use strict';

const Joi = require('joi');

const moduleName = Joi.string().valid('event', 'hand', 'impact', 'trend');
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
    // mode is always 'product' on the public endpoint; the service enforces this
    // regardless, but accepting the param lets clients be explicit.
    mode: Joi.string().valid('product').default('product'),
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

const createScenarioSchema = Joi.object({
    code: Joi.string().trim().max(100).required().messages({
        'any.required': 'Mã kịch bản là bắt buộc',
        'string.empty': 'Mã kịch bản không được để trống',
    }),
    nameVi: Joi.string().trim().max(255).required().messages({
        'any.required': 'Tên kịch bản là bắt buộc',
        'string.empty': 'Tên kịch bản không được để trống',
    }),
    minRainfall: Joi.number().min(0).default(0.0),
    maxRainfall: Joi.number().min(0).allow(null),
    minTide: Joi.number().allow(null),
    maxTide: Joi.number().allow(null),
    layerCode: Joi.string().trim().max(120).required().messages({
        'any.required': 'Mã lớp bản đồ liên kết là bắt buộc',
        'string.empty': 'Mã lớp bản đồ liên kết không được để trống',
    }),
    description: Joi.string().allow(null, '').default(null),
    isActive: Joi.boolean().default(true),
    currentRainfall: Joi.number().min(0).allow(null).default(null),
    rainfallSource: Joi.string().valid('MANUAL', 'AUTO').default('MANUAL'),
    currentTide: Joi.number().allow(null).default(null),
    tideSource: Joi.string().valid('MANUAL', 'AUTO').default('MANUAL'),
}).unknown(false);

const updateScenarioSchema = Joi.object({
    code: Joi.string().trim().max(100),
    nameVi: Joi.string().trim().max(255),
    minRainfall: Joi.number().min(0),
    maxRainfall: Joi.number().min(0).allow(null),
    minTide: Joi.number().allow(null),
    maxTide: Joi.number().allow(null),
    layerCode: Joi.string().trim().max(120),
    description: Joi.string().allow(null, ''),
    isActive: Joi.boolean(),
    currentRainfall: Joi.number().min(0).allow(null),
    rainfallSource: Joi.string().valid('MANUAL', 'AUTO'),
    currentTide: Joi.number().allow(null),
    tideSource: Joi.string().valid('MANUAL', 'AUTO'),
}).unknown(false);

const queryScenarioSchema = Joi.object({
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(20),
    activeOnly: Joi.boolean().default(false),
    search: Joi.string().allow('', null),
}).unknown(false);

const legendModuleName = Joi.string().valid('event', 'hand', 'rain', 'impact', 'trend');

const legendQuerySchema = Joi.object({
    module: legendModuleName,
}).unknown(false);

const legendCodeParamsSchema = Joi.object({
    code: Joi.string().pattern(/^[a-z0-9_]+$/).max(100).required().messages({
        'string.pattern.base': '"code" chỉ được chứa chữ thường, chữ số và dấu gạch dưới',
    }),
}).unknown(false);

const legendLabel = Joi.object({
    vi: Joi.string().max(255),
    en: Joi.string().max(255),
}).unknown(false);

const updateLegendSchema = Joi.object({
    label: legendLabel,
    palette: Joi.array().items(Joi.string().pattern(/^[0-9a-fA-F]{3,6}$/).required()).min(1).max(20),
    min: Joi.number(),
    max: Joi.number(),
}).unknown(false).min(1);

module.exports = {
    listSchema,
    publicListSchema,
    submitSchema,
    idParamsSchema,
    simulationSchema,
    createScenarioSchema,
    updateScenarioSchema,
    queryScenarioSchema,
    legendQuerySchema,
    legendCodeParamsSchema,
    updateLegendSchema,
};

