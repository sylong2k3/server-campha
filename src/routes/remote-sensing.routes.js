'use strict';

const { Router } = require('express');
const rateLimit = require('express-rate-limit');
const asyncHandler = require('../helpers/async-handler');
const controller = require('../controllers/remote-sensing.controller');
const v = require('../validators/remote-sensing.validator');
const {
    optionalAuth,
    verifyToken,
    enforcePasswordChange,
} = require('../middlewares/auth.middleware');
const { validate } = require('../middlewares/validate.middleware');
const strict = (schema, source = 'body') => validate(schema, source, { stripUnknown: false });
const downloadLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => `user:${req.user.id}`,
});
const publicRouter = Router();
publicRouter.use(optionalAuth);
publicRouter.get('/images', strict(v.listSchema, 'query'), asyncHandler(controller.list));
publicRouter.get('/images/:id', strict(v.idParamsSchema, 'params'), asyncHandler(controller.get));
publicRouter.get('/compare', strict(v.compareSchema, 'query'), asyncHandler(controller.compare));
publicRouter.get(
    '/images/:id/download-url',
    verifyToken,
    enforcePasswordChange,
    downloadLimiter,
    strict(v.idParamsSchema, 'params'),
    strict(v.downloadQuerySchema, 'query'),
    asyncHandler(controller.download),
);
const adminRouter = Router();
adminRouter.use(verifyToken, enforcePasswordChange);
adminRouter.get('/images', strict(v.listSchema, 'query'), asyncHandler(controller.listAdmin));
adminRouter.post('/images', strict(v.createSchema), asyncHandler(controller.create));
adminRouter.post(
    '/images/:id/publish',
    strict(v.idParamsSchema, 'params'),
    strict(v.publishSchema),
    asyncHandler(controller.publish),
);
adminRouter.patch(
    '/images/:id/category',
    strict(v.idParamsSchema, 'params'),
    strict(v.categorySchema),
    asyncHandler(controller.categorize),
);
adminRouter.delete(
    '/images/:id',
    strict(v.idParamsSchema, 'params'),
    strict(v.deleteQuerySchema, 'query'),
    asyncHandler(controller.remove),
);
module.exports = { publicRouter, adminRouter };
