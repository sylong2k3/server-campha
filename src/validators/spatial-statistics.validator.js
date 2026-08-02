'use strict';
const Joi = require('joi');
const id = Joi.number().integer().positive();
const identifier = Joi.string().pattern(/^[a-z][a-z0-9_]{0,62}$/);
const sourceTypes = ['flood', 'residential', 'infrastructure', 'administrative_boundary'];
const sourceFields = {
    sourceType: Joi.string()
        .valid(...sourceTypes)
        .required(),
    observedYear: Joi.number().integer().min(1900).max(2200),
    observedAt: Joi.date().iso(),
    geometryColumn: identifier.default('geom'),
    administrativeCodeColumn: identifier,
    administrativeNameColumn: identifier,
    labelColumn: identifier,
};
const sourceRule = (value, helpers) => {
    const boundary = value.sourceType === 'administrative_boundary',
        hasBoundary = value.administrativeCodeColumn && value.administrativeNameColumn;
    if (
        boundary !== Boolean(hasBoundary) ||
        (!boundary && !value.observedYear && !value.observedAt)
    ) {
        return helpers.error('any.invalid');
    }
    return value;
};
const createSourceSchema = Joi.object({ layerId: id.required(), ...sourceFields }).custom(
    sourceRule,
    'source consistency',
);
const updateSourceSchema = Joi.object({
    ...sourceFields,
    expectedUpdatedAt: Joi.date().iso().required(),
}).custom(sourceRule, 'source consistency');
const sourceParamsSchema = Joi.object({ id: id.required() });
const listSchema = Joi.object({
    type: Joi.string().valid(...sourceTypes),
    year: Joi.number().integer().min(1900).max(2200),
});
const areasSchema = listSchema.keys({ administrativeCode: Joi.string().trim().max(120) });
const refreshSchema = Joi.object({ boundarySourceId: id.allow(null) });
const compareSchema = Joi.object({
    beforeSourceId: id.required(),
    afterSourceId: id.invalid(Joi.ref('beforeSourceId')).required(),
});
module.exports = {
    sourceTypes,
    createSourceSchema,
    updateSourceSchema,
    sourceParamsSchema,
    listSchema,
    areasSchema,
    refreshSchema,
    compareSchema,
};
