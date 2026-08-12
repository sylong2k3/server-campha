'use strict';

const Joi = require('joi');

const classId = Joi.number().integer().min(0).max(12).required();
const observedAt = Joi.date().iso().max('now').required();
const text = (max) => Joi.string().trim().max(max).allow('', null);

const validateCoordinateTree = (coordinates, helpers) => {
    let points = 0;
    const visit = (node) => {
        if (!Array.isArray(node) || node.length === 0) {
            return false;
        }
        if (typeof node[0] === 'number') {
            if (node.length < 2 || !Number.isFinite(node[0]) || !Number.isFinite(node[1])) {
                return false;
            }
            // Operational guardrail: accept the Quảng Ninh/Cẩm Phả vicinity,
            // while leaving enough tolerance for authoritative boundary data.
            if (node[0] < 106 || node[0] > 109 || node[1] < 20 || node[1] > 22.5) {
                return false;
            }
            points += 1;
            return points <= 100000;
        }
        return node.every(visit);
    };
    return visit(coordinates) ? coordinates : helpers.error('any.invalid');
};

const geometry = Joi.object({
    type: Joi.string().valid('Polygon', 'MultiPolygon').required(),
    coordinates: Joi.array().required().custom(validateCoordinateTree, 'coordinate guardrail'),
}).unknown(false);

const zoneCreate = Joi.object({
    name: text(255),
    observedAt,
    classId,
    source: text(100).default('field_survey'),
    geom: geometry.required(),
    notes: text(2000),
}).unknown(false);

const featureCollection = Joi.object({
    type: Joi.string().valid('FeatureCollection').required(),
    features: Joi.array()
        .min(1)
        .max(500)
        .items(
            Joi.object({
                type: Joi.string().valid('Feature').required(),
                geometry: geometry.required(),
                properties: Joi.object()
                    .custom((value, helpers) => {
                        const candidate = value.classId ?? value.class_id ?? value.class;
                        const parsed = Number(candidate);
                        if (!Number.isInteger(parsed) || parsed < 0 || parsed > 12) {
                            return helpers.error('any.invalid');
                        }
                        return value;
                    }, 'forest class guardrail')
                    .required()
                    .unknown(true),
            }).unknown(false),
        )
        .required(),
}).unknown(false);

const pointCreate = Joi.object({
    observedAt,
    classId,
    lng: Joi.number().min(106).max(109).required(),
    lat: Joi.number().min(20).max(22.5).required(),
    source: text(100).default('field_report'),
    photoUrl: Joi.string()
        .uri({ scheme: ['http', 'https'] })
        .max(2048)
        .allow('', null),
    reporterName: text(255),
    notes: text(2000),
}).unknown(false);

const pointBulk = Joi.object({
    points: Joi.array().min(1).max(1000).items(pointCreate).required(),
}).unknown(false);

const listQuery = Joi.object({
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(200).default(50),
    from: Joi.date().iso(),
    to: Joi.date().iso().greater(Joi.ref('from')),
    classId: Joi.number().integer().min(0).max(12),
}).unknown(false);

module.exports = {
    zoneCreate,
    featureCollection,
    pointCreate,
    pointBulk,
    listQuery,
};
