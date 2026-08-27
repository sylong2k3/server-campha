'use strict';
const Joi = require('joi');
const coordinate = Joi.array()
    .length(2)
    .ordered(
        Joi.number().min(107).max(108).required(),
        Joi.number().min(20.7).max(21.3).required(),
    );
const line = Joi.array().items(coordinate).min(2).max(500);
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
const tileParams = Joi.object({
    layerId: Joi.number().integer().positive().required(),
    z: Joi.number().integer().min(0).max(22).required(),
    x: Joi.number().integer().min(0).required(),
    y: Joi.string()
        .pattern(/^\d+\.mvt$/)
        .required(),
}).custom((value, helpers) =>
    value.x < 2 ** value.z && Number(value.y.slice(0, -4)) < 2 ** value.z
        ? value
        : helpers.error('any.invalid'),
);
const featureParams = Joi.object({
    layerId: Joi.number().integer().positive().required(),
    featureId: Joi.string()
        .trim()
        .pattern(/^[A-Za-z0-9_-]{1,120}$/)
        .required(),
});
const layerParams = Joi.object({ layerId: Joi.number().integer().positive().required() });
const idParams = Joi.object({ id: Joi.number().integer().positive().required() });
const nearbyQuery = Joi.object({
    longitude: Joi.number().min(107).max(108).required(),
    latitude: Joi.number().min(20.7).max(21.3).required(),
    radiusMeters: Joi.number().integer().min(10).max(2000).default(200),
    limit: Joi.number().integer().min(1).max(100).default(20),
});
const closedPolygon = (value) =>
    !value.geometry ||
    value.geometry.type !== 'Polygon' ||
    value.geometry.coordinates.every(
        (ring) => ring[0][0] === ring.at(-1)[0] && ring[0][1] === ring.at(-1)[1],
    );
const measureBody = Joi.object({ geometry: geometry.required() }).custom((value, helpers) =>
    value.geometry.type !== 'Point' && closedPolygon(value) ? value : helpers.error('any.invalid'),
);
const jsonDepth = (value) =>
    value && typeof value === 'object'
        ? 1 + Math.max(0, ...Object.values(value).map(jsonDepth))
        : 0;
const properties = Joi.object()
    .max(30)
    .custom(
        (value, helpers) =>
            Buffer.byteLength(JSON.stringify(value)) <= 16384 && jsonDepth(value) <= 4
                ? value
                : helpers.error('any.invalid'),
        'bounded draft properties',
    )
    .default({});
const draftBody = Joi.object({
    title: Joi.string()
        .trim()
        .min(1)
        .max(200)
        .pattern(/<[^>]+>/, { invert: true })
        .required(),
    properties,
    geometry: geometry.required(),
}).custom((value, helpers) => (closedPolygon(value) ? value : helpers.error('any.invalid')));
const pageQuery = Joi.object({
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(20),
});
const deleteQuery = Joi.object({ expectedUpdatedAt: Joi.date().iso().required() });
const weatherQuery = Joi.object({
    longitude: Joi.number().required(),
    latitude: Joi.number().required(),
});
const routeBody = Joi.object({
    start: coordinate.required(),
    end: coordinate.invalid(Joi.ref('start')).required(),
    profile: Joi.string().valid('driving', 'walking', 'cycling').default('driving'),
});
const scalar = Joi.alternatives().try(
    Joi.string().max(2000),
    Joi.number(),
    Joi.boolean(),
    Joi.valid(null),
);
const attributes = Joi.object()
    .pattern(/^[A-Za-z_][A-Za-z0-9_]{0,62}$/, scalar)
    .max(30);
const featureChange = Joi.object({
    baseVersion: Joi.number().integer().min(1).required(),
    attributes,
    geometry,
})
    .or('attributes', 'geometry')
    .custom((value, helpers) => (closedPolygon(value) ? value : helpers.error('any.invalid')));
const versionParams = featureParams.keys({ version: Joi.number().integer().min(1).required() });
const restoreBody = Joi.object({ baseVersion: Joi.number().integer().min(1).required() });
const syncChange = featureChange.keys({
    clientChangeId: Joi.string().guid({ version: 'uuidv4' }).required(),
    layerId: Joi.number().integer().positive().required(),
    featureId: Joi.string()
        .trim()
        .pattern(/^[A-Za-z0-9_-]{1,120}$/)
        .required(),
});
const syncBody = Joi.object({
    clientId: Joi.string().guid({ version: 'uuidv4' }).required(),
    changes: Joi.array().items(syncChange).min(1).max(50).unique('clientChangeId').required(),
});
module.exports = {
    tileParams,
    featureParams,
    layerParams,
    idParams,
    nearbyQuery,
    measureBody,
    draftBody,
    pageQuery,
    deleteQuery,
    weatherQuery,
    routeBody,
    featureChange,
    versionParams,
    restoreBody,
    syncBody,
};
