'use strict';
const { Router } = require('express');
const rateLimit = require('express-rate-limit');
const asyncHandler = require('../helpers/async-handler');
const controller = require('../controllers/spatial-statistics.controller');
const validator = require('../validators/spatial-statistics.validator');
const { verifyToken, enforcePasswordChange } = require('../middlewares/auth.middleware');
const { validate } = require('../middlewares/validate.middleware');
const strict = (schema, source = 'body') => validate(schema, source, { stripUnknown: false });
const analyzeLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => `user:${req.user.id}`,
});
const publicRouter = Router(),
    adminRouter = Router();
publicRouter.use(verifyToken, enforcePasswordChange);
publicRouter.get(
    '/sources',
    strict(validator.listSchema, 'query'),
    asyncHandler(controller.listSources),
);
publicRouter.get('/areas', strict(validator.areasSchema, 'query'), asyncHandler(controller.areas));
publicRouter.get(
    '/compare',
    analyzeLimiter,
    strict(validator.compareSchema, 'query'),
    asyncHandler(controller.compare),
);
adminRouter.use(verifyToken, enforcePasswordChange);
adminRouter.post(
    '/sources',
    analyzeLimiter,
    strict(validator.createSourceSchema),
    asyncHandler(controller.createSource),
);
adminRouter.patch(
    '/sources/:id',
    analyzeLimiter,
    strict(validator.sourceParamsSchema, 'params'),
    strict(validator.updateSourceSchema),
    asyncHandler(controller.updateSource),
);
adminRouter.post(
    '/sources/:id/refresh',
    analyzeLimiter,
    strict(validator.sourceParamsSchema, 'params'),
    strict(validator.refreshSchema),
    asyncHandler(controller.refresh),
);
module.exports = { publicRouter, adminRouter };
