'use strict';
const Joi = require('joi');
const slug = Joi.object({
        slug: Joi.string()
            .pattern(/^[a-z][a-z0-9-]{2,79}$/)
            .required(),
    }),
    feature = Joi.object({
        slug: Joi.string()
            .pattern(/^[a-z][a-z0-9-]{2,79}$/)
            .required(),
        featureId: Joi.string().trim().min(1).max(120).required(),
    });
const list = Joi.object({
    q: Joi.string().trim().max(200).allow('').optional(),
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().valid(10, 20, 50, 100).default(20),
    sortBy: Joi.string()
        .pattern(/^[A-Za-z_][A-Za-z0-9_]{0,62}$/)
        .optional(),
    sortOrder: Joi.string().uppercase().valid('ASC', 'DESC').default('DESC'),
    includeGeometry: Joi.boolean().default(true),
});
const scalar = Joi.alternatives().try(
    Joi.string().max(2000),
    Joi.number(),
    Joi.boolean(),
    Joi.valid(null),
);
const coordinate = Joi.array()
        .length(2)
        .ordered(
            Joi.number().min(107).max(108).required(),
            Joi.number().min(20.7).max(21.3).required(),
        ),
    line = Joi.array().items(coordinate).min(2).max(500);
const geometry = Joi.alternatives().try(
    Joi.object({
        type: Joi.string().valid('Point').required(),
        coordinates: coordinate.required(),
    }),
    Joi.object({ type: Joi.string().valid('LineString').required(), coordinates: line.required() }),
    Joi.object({
        type: Joi.string().valid('Polygon').required(),
        coordinates: Joi.array().items(line.min(4)).min(1).max(10).required(),
    }),
);
const closed = (value) =>
    !value.geometry ||
    value.geometry.type !== 'Polygon' ||
    value.geometry.coordinates.every((r) => r[0][0] === r.at(-1)[0] && r[0][1] === r.at(-1)[1]);
const attributes = Joi.object()
    .pattern(/^[A-Za-z_][A-Za-z0-9_]{0,62}$/, scalar)
    .max(30);
const create = Joi.object({
    featureId: Joi.string()
        .trim()
        .pattern(/^[A-Za-z0-9_-]{1,120}$/)
        .required(),
    attributes: attributes.required(),
    geometry: geometry.required(),
}).custom((value, helpers) => (closed(value) ? value : helpers.error('any.invalid')));
const update = Joi.object({
    baseVersion: Joi.number().integer().positive().required(),
    attributes: attributes.default({}),
    geometry,
})
    .or('attributes', 'geometry')
    .custom((value, helpers) => (closed(value) ? value : helpers.error('any.invalid')));
const remove = Joi.object({ baseVersion: Joi.number().integer().positive().required() });
module.exports = { slug, feature, list, create, update, remove };
