'use strict';
const Joi = require('joi');
const id = Joi.number().integer().positive();
// Chỉ kiểm tra toạ độ hợp lệ theo WGS84. Không chặn theo ranh giới Cẩm Phả
// nữa — hệ dùng chung cho nhiều địa phương.
const inBounds = (coordinates) =>
    Array.isArray(coordinates) &&
    (typeof coordinates[0] === 'number'
        ? coordinates.length >= 2 &&
          Number.isFinite(coordinates[0]) &&
          Number.isFinite(coordinates[1]) &&
          coordinates[0] >= -180 &&
          coordinates[0] <= 180 &&
          coordinates[1] >= -90 &&
          coordinates[1] <= 90
        : coordinates.every(inBounds));
const geometry = Joi.object({
    type: Joi.string().valid('Point', 'LineString', 'Polygon').required(),
    coordinates: Joi.array().required(),
}).custom((value, helpers) => {
    const serialized = JSON.stringify(value);
    if (
        serialized.length > 100000 ||
        (serialized.match(/\[/g) || []).length > 1000 ||
        !inBounds(value.coordinates)
    ) {
        return helpers.error('any.invalid');
    }
    return value;
}, 'bounded geometry');
const createSchema = Joi.object({
    description: Joi.string()
        .trim()
        .min(10)
        .max(2000)
        .pattern(/<[^>]+>/, { invert: true })
        .required(),
    longitude: Joi.number().min(-180).max(180).required(),
    latitude: Joi.number().min(-90).max(90).required(),
    measuredGeometry: geometry,
    photoIds: Joi.array().items(id).unique().max(5).default([]),
});
const listSchema = Joi.object({
    status: Joi.string().valid('pending', 'under_review', 'approved', 'rejected', 'resolved'),
    q: Joi.string().trim().min(1).max(100).optional(),
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(20),
});
const idParamsSchema = Joi.object({ id: id.required() });
const deleteSchema = Joi.object({
    expectedUpdatedAt: Joi.date().iso().required(),
    deleteFiles: Joi.boolean().default(false),
});
const reviewSchema = Joi.object({
    status: Joi.string().valid('under_review', 'approved', 'rejected', 'resolved').required(),
    reason: Joi.string()
        .trim()
        .min(5)
        .max(1000)
        .when('status', { is: 'rejected', then: Joi.required() }),
    expectedUpdatedAt: Joi.date().iso().required(),
});
const nearbySchema = Joi.object({
    longitude: Joi.number().min(-180).max(180).required(),
    latitude: Joi.number().min(-90).max(90).required(),
    radiusMeters: Joi.number().integer().min(10).max(500).default(100),
    from: Joi.date().iso().required(),
    to: Joi.date().iso().greater(Joi.ref('from')).required(),
}).custom(
    (value, helpers) =>
        new Date(value.to) - new Date(value.from) <= 366 * 86400000
            ? value
            : helpers.error('any.invalid'),
    'bounded range',
);
const clusterSchema = Joi.object({
    radiusMeters: Joi.number().integer().min(10).max(500).default(100),
    minReporters: Joi.number().integer().min(2).max(20).default(2),
    from: Joi.date().iso().required(),
    to: Joi.date().iso().greater(Joi.ref('from')).required(),
}).custom(
    (value, helpers) =>
        new Date(value.to) - new Date(value.from) <= 366 * 86400000
            ? value
            : helpers.error('any.invalid'),
    'bounded range',
);
const deviceSchema = Joi.object({
    token: Joi.string().trim().min(32).max(4096).required(),
    platform: Joi.string().valid('android', 'ios', 'web').required(),
});
const deviceDeleteSchema = Joi.object({ token: Joi.string().trim().min(32).max(4096).required() });
module.exports = {
    createSchema,
    listSchema,
    idParamsSchema,
    deleteSchema,
    reviewSchema,
    nearbySchema,
    clusterSchema,
    deviceSchema,
    deviceDeleteSchema,
};
