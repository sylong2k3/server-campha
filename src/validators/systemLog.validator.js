const Joi = require('joi');

const LOG_LEVELS = ['debug', 'info', 'warn', 'error'];

const listSystemLogsSchema = Joi.object({
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(20),
    level: Joi.string()
        .valid(...LOG_LEVELS)
        .optional(),
    source: Joi.string().trim().max(50).optional(),
    q: Joi.string().trim().max(255).optional().allow(''),
    dateFrom: Joi.date().iso().optional(),
    dateTo: Joi.date().iso().optional(),
});

const cleanupSystemLogsSchema = Joi.object({
    olderThanDays: Joi.number().integer().min(1).max(3650).default(90),
});

module.exports = { listSystemLogsSchema, cleanupSystemLogsSchema };
