'use strict';
const Joi = require('joi');
const listSchema = Joi.object({
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(20),
    unreadOnly: Joi.boolean().default(false),
});
const idParamsSchema = Joi.object({ id: Joi.number().integer().positive().required() });
module.exports = { listSchema, idParamsSchema };
