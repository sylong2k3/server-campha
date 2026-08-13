'use strict';
const { Router } = require('express');
const rateLimit = require('express-rate-limit');
const asyncHandler = require('../helpers/async-handler');
const controller = require('../controllers/field-report.controller');
const v = require('../validators/field-report.validator');
const {
    optionalAuth,
    verifyToken,
    enforcePasswordChange,
} = require('../middlewares/auth.middleware');
const { validate } = require('../middlewares/validate.middleware');
const strict = (schema, source = 'body') => validate(schema, source, { stripUnknown: false });
const createLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => `user:${req.user.id}`,
});
const analyzeLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => `user:${req.user.id}`,
});
const publicRouter = Router(),
    adminRouter = Router(),
    deviceRouter = Router();
publicRouter.get(
    '/public',
    optionalAuth,
    strict(v.listSchema, 'query'),
    asyncHandler(controller.listPublic),
);
publicRouter.get(
    '/nearby',
    optionalAuth,
    strict(v.nearbySchema, 'query'),
    asyncHandler(controller.nearby),
);
publicRouter.get(
    '/public/:id',
    strict(v.idParamsSchema, 'params'),
    asyncHandler(controller.getPublic),
);
publicRouter.use(verifyToken, enforcePasswordChange);
publicRouter.get('/mine', strict(v.listSchema, 'query'), asyncHandler(controller.listMine));
publicRouter.post('/', createLimiter, strict(v.createSchema), asyncHandler(controller.create));
publicRouter.get('/:id', strict(v.idParamsSchema, 'params'), asyncHandler(controller.get));
publicRouter.delete(
    '/:id',
    strict(v.idParamsSchema, 'params'),
    strict(v.deleteSchema, 'query'),
    asyncHandler(controller.remove),
);
adminRouter.use(verifyToken, enforcePasswordChange);
adminRouter.get('/', strict(v.listSchema, 'query'), asyncHandler(controller.listAdmin));
adminRouter.get(
    '/clusters',
    analyzeLimiter,
    strict(v.clusterSchema, 'query'),
    asyncHandler(controller.clusters),
);
adminRouter.patch(
    '/:id/review',
    analyzeLimiter,
    strict(v.idParamsSchema, 'params'),
    strict(v.reviewSchema),
    asyncHandler(controller.review),
);
deviceRouter.use(verifyToken, enforcePasswordChange);
deviceRouter.put('/push-token', strict(v.deviceSchema), asyncHandler(controller.registerDevice));
deviceRouter.delete(
    '/push-token',
    strict(v.deviceDeleteSchema),
    asyncHandler(controller.unregisterDevice),
);
module.exports = { publicRouter, adminRouter, deviceRouter };
