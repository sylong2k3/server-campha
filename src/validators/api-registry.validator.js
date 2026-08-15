'use strict';
const Joi = require('joi');
const id = Joi.number().integer().positive().required(),
    field = Joi.string().pattern(/^[A-Za-z_][A-Za-z0-9_]{0,62}$/),
    methods = Joi.array()
        .items(Joi.string().valid('GET', 'POST', 'PUT', 'DELETE'))
        .unique()
        .min(1)
        .max(4),
    scopes = Joi.array()
        .items(
            Joi.string().valid(
                'features:read',
                'features:create',
                'features:update',
                'features:delete',
            ),
        )
        .unique()
        .min(1)
        .max(4);
const registryParams = Joi.object({ registryId: id }),
    keyParams = Joi.object({
        keyId: Joi.string()
            .guid({ version: ['uuidv4'] })
            .required(),
    }),
    listQuery = Joi.object({
        q: Joi.string().trim().max(200).allow('').optional(),
        page: Joi.number().integer().min(1).default(1),
        limit: Joi.number().integer().valid(10, 20, 50, 100).default(20),
        // Accept both camelCase and snake_case for isActive/layerId so callers
        // wired to the legacy DB column names keep working.
        isActive: Joi.boolean().optional(),
        is_active: Joi.boolean().optional(),
        layerId: Joi.number().integer().positive().optional(),
        layer_id: Joi.number().integer().positive().optional(),
        sortBy: Joi.string()
            .valid('created_at', 'updated_at', 'name', 'slug')
            .default('created_at'),
        sortOrder: Joi.string().uppercase().valid('ASC', 'DESC').default('DESC'),
    });
const registryBody = Joi.object({
    layerId: id,
    slug: Joi.string()
        .pattern(/^[a-z][a-z0-9-]{2,79}$/)
        .required(),
    name: Joi.string().trim().min(2).max(200).required(),
    readFields: Joi.array().items(field).unique().min(1).max(50).required(),
    writeFields: Joi.array().items(field).unique().max(30).default([]),
    searchFields: Joi.array().items(field).unique().max(10).default([]),
    allowedMethods: methods.default(['GET']),
    defaultSortField: field.required(),
});
const registryUpdate = Joi.object({
    expectedVersion: Joi.number().integer().positive().required(),
    name: Joi.string().trim().min(2).max(200),
    readFields: Joi.array().items(field).unique().min(1).max(50),
    writeFields: Joi.array().items(field).unique().max(30),
    searchFields: Joi.array().items(field).unique().max(10),
    allowedMethods: methods,
    defaultSortField: field,
    isActive: Joi.boolean(),
}).or(
    'name',
    'readFields',
    'writeFields',
    'searchFields',
    'allowedMethods',
    'defaultSortField',
    'isActive',
);
const deleteQuery = Joi.object({ expectedVersion: Joi.number().integer().positive().required() });
const keyBody = Joi.object({
    name: Joi.string().trim().min(2).max(120).required(),
    consumer: Joi.string().trim().min(2).max(200).required(),
    scopes: scopes.default(['features:read']),
    quotaPerMinute: Joi.number().integer().min(1).max(1000).default(60),
    expiresInHours: Joi.number().integer().min(1).max(2160).default(720),
});
const rotateBody = Joi.object({
    expiresInHours: Joi.number().integer().min(1).max(2160).default(720),
});
const usageQuery = Joi.object({
    from: Joi.date().iso().optional(),
    to: Joi.date().iso().min(Joi.ref('from')).optional(),
});
module.exports = {
    registryParams,
    keyParams,
    listQuery,
    registryBody,
    registryUpdate,
    deleteQuery,
    keyBody,
    rotateBody,
    usageQuery,
};
