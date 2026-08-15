'use strict';
const Joi = require('joi');
const listSchema = Joi.object({
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(20),
    unreadOnly: Joi.boolean().default(false),
});
const idParamsSchema = Joi.object({ id: Joi.number().integer().positive().required() });
const messageFields = {
    channel: Joi.string()
        .trim()
        .pattern(/^[a-z][a-z0-9_]{1,49}$/)
        .default('system'),
    type: Joi.string()
        .trim()
        .pattern(/^[a-z][a-z0-9_]{1,49}$/)
        .required(),
    title: Joi.string().trim().min(1).max(255).required(),
    body: Joi.string().trim().min(1).max(2000).required(),
    data: Joi.object().unknown(true).default({}),
};
const sendSchema = Joi.alternatives()
    .try(
        Joi.object({
            target: Joi.string().valid('user').required(),
            userId: Joi.number().integer().positive().required(),
            ...messageFields,
        }),
        Joi.object({
            target: Joi.string().valid('role').required(),
            roleCode: Joi.string()
                .trim()
                .pattern(/^[a-z0-9_]{2,30}$/)
                .required(),
            ...messageFields,
        }),
        Joi.object({
            target: Joi.string().valid('all').required(),
            ...messageFields,
        }),
    )
    .match('one');
module.exports = { listSchema, idParamsSchema, sendSchema };
