'use strict';
const { Router } = require('express');
const rateLimit = require('express-rate-limit');
const asyncHandler = require('../helpers/async-handler');
const controller = require('../controllers/mobile-gis.controller');
const v = require('../validators/mobile-gis.validator');
const {
    optionalAuth,
    verifyToken,
    enforcePasswordChange,
} = require('../middlewares/auth.middleware');
const { validate } = require('../middlewares/validate.middleware');
const strict = (schema, source = 'body') => validate(schema, source, { stripUnknown: false });
const router = Router(),
    readLimiter = rateLimit({
        windowMs: 60000,
        max: 180,
        standardHeaders: true,
        legacyHeaders: false,
    }),
    writeLimiter = rateLimit({
        windowMs: 60000,
        max: 30,
        standardHeaders: true,
        legacyHeaders: false,
        keyGenerator: (req) => `user:${req.user.id}`,
    });
router.get(
    '/layers/:layerId/tiles/:z/:x/:y',
    optionalAuth,
    readLimiter,
    strict(v.tileParams, 'params'),
    asyncHandler(controller.tile),
);
router.get(
    '/layers/:layerId/features/:featureId',
    optionalAuth,
    readLimiter,
    strict(v.featureParams, 'params'),
    asyncHandler(controller.feature),
);
router.get(
    '/layers/:layerId/nearby',
    optionalAuth,
    readLimiter,
    strict(v.layerParams, 'params'),
    strict(v.nearbyQuery, 'query'),
    asyncHandler(controller.nearby),
);
router.get(
    '/weather/current',
    optionalAuth,
    readLimiter,
    strict(v.weatherQuery, 'query'),
    asyncHandler(controller.weather),
);
router.post(
    '/measure',
    optionalAuth,
    readLimiter,
    strict(v.measureBody),
    asyncHandler(controller.measure),
);
router.post(
    '/routes/shortest',
    optionalAuth,
    readLimiter,
    strict(v.routeBody),
    asyncHandler(controller.route),
);
router.use(verifyToken, enforcePasswordChange);
router.post('/drafts', writeLimiter, strict(v.draftBody), asyncHandler(controller.createDraft));
router.get('/drafts', strict(v.pageQuery, 'query'), asyncHandler(controller.listDrafts));
router.get('/drafts/:id', strict(v.idParams, 'params'), asyncHandler(controller.getDraft));
router.delete(
    '/drafts/:id',
    writeLimiter,
    strict(v.idParams, 'params'),
    strict(v.deleteQuery, 'query'),
    asyncHandler(controller.removeDraft),
);
router.patch(
    '/layers/:layerId/features/:featureId',
    writeLimiter,
    strict(v.featureParams, 'params'),
    strict(v.featureChange),
    asyncHandler(controller.updateFeature),
);
router.get(
    '/layers/:layerId/features/:featureId/history',
    readLimiter,
    strict(v.featureParams, 'params'),
    asyncHandler(controller.featureHistory),
);
router.post(
    '/layers/:layerId/features/:featureId/restore/:version',
    writeLimiter,
    strict(v.versionParams, 'params'),
    strict(v.restoreBody),
    asyncHandler(controller.restoreFeature),
);
router.post('/sync', writeLimiter, strict(v.syncBody), asyncHandler(controller.sync));
module.exports = router;
