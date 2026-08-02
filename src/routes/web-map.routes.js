'use strict';

const { Router } = require('express');
const rateLimit = require('express-rate-limit');
const asyncHandler = require('../helpers/async-handler');
const controller = require('../controllers/web-map.controller');
const validator = require('../validators/web-map.validator');
const { optionalAuth } = require('../middlewares/auth.middleware');
const { validate } = require('../middlewares/validate.middleware');

const router = Router();
const strict = (schema, source = 'query') => validate(schema, source, { stripUnknown: false });
const spatialLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: Number(process.env.WEB_MAP_RATE_LIMIT || 120),
    standardHeaders: true,
    legacyHeaders: false,
    message: {
        success: false,
        message: 'Quá nhiều truy vấn bản đồ',
        errors: ['TOO_MANY_MAP_REQUESTS'],
    },
});
router.use(optionalAuth, spatialLimiter);
router.get('/layers', strict(validator.catalogQuerySchema), asyncHandler(controller.listLayers));
router.get(
    '/layers/:layerId/features/:featureId',
    validate(validator.featureParamsSchema, 'params'),
    strict(validator.featureQuerySchema),
    asyncHandler(controller.getFeature),
);
router.get(
    '/features/search',
    strict(validator.featureSearchSchema),
    asyncHandler(controller.searchFeatures),
);
router.get(
    '/layers/:layerId/legend',
    validate(validator.layerIdParamsSchema, 'params'),
    asyncHandler(controller.getLegend),
);
router.get('/basemaps', asyncHandler(controller.listBasemaps));
router.get('/terrain', asyncHandler(controller.listTerrain));
router.get(
    '/terrain/:layerId/url',
    validate(validator.layerIdParamsSchema, 'params'),
    strict(validator.terrainUrlQuerySchema),
    asyncHandler(controller.getTerrainUrl),
);

module.exports = router;
