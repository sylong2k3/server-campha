'use strict';

const { Router } = require('express');
const rateLimit = require('express-rate-limit');
const asyncHandler = require('../helpers/async-handler');
const controller = require('../controllers/kttv.controller');
const v = require('../validators/kttv.validator');
const { verifyToken, enforcePasswordChange } = require('../middlewares/auth.middleware');
const { validate } = require('../middlewares/validate.middleware');

const strict = (schema, source = 'body') => validate(schema, source, { stripUnknown: false });

// KTTV là module cấu hình nội bộ (Sprint 10a) — chưa có mặt public, chỉ adminRouter.
const adminRouter = Router();
adminRouter.use(verifyToken, enforcePasswordChange);

// test-connection tự gọi ra dịch vụ ngoài — giới hạn riêng để tránh lạm dụng làm bàn đạp SSRF/DoS.
const testConnectionLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => `user:${req.user.id}`,
});

adminRouter.get(
    '/sources',
    strict(v.sourceListSchema, 'query'),
    asyncHandler(controller.listSources),
);
adminRouter.post('/sources', strict(v.sourceCreateSchema), asyncHandler(controller.createSource));
adminRouter.get(
    '/sources/:id',
    strict(v.sourceIdParamsSchema, 'params'),
    asyncHandler(controller.getSource),
);
adminRouter.patch(
    '/sources/:id',
    strict(v.sourceIdParamsSchema, 'params'),
    strict(v.sourceUpdateSchema),
    asyncHandler(controller.updateSource),
);
adminRouter.delete(
    '/sources/:id',
    strict(v.sourceIdParamsSchema, 'params'),
    strict(v.deleteQuerySchema, 'query'),
    asyncHandler(controller.deleteSource),
);
adminRouter.post(
    '/sources/:id/test-connection',
    testConnectionLimiter,
    strict(v.sourceIdParamsSchema, 'params'),
    asyncHandler(controller.testSourceConnection),
);

adminRouter.get(
    '/stations',
    strict(v.stationListSchema, 'query'),
    asyncHandler(controller.listStations),
);
adminRouter.post(
    '/stations',
    strict(v.stationCreateSchema),
    asyncHandler(controller.createStation),
);
adminRouter.get(
    '/stations/:code',
    strict(v.stationCodeParamsSchema, 'params'),
    asyncHandler(controller.getStation),
);
adminRouter.patch(
    '/stations/:code',
    strict(v.stationCodeParamsSchema, 'params'),
    strict(v.stationUpdateSchema),
    asyncHandler(controller.updateStation),
);
adminRouter.delete(
    '/stations/:code',
    strict(v.stationCodeParamsSchema, 'params'),
    strict(v.deleteQuerySchema, 'query'),
    asyncHandler(controller.deleteStation),
);

adminRouter.get(
    '/scenarios',
    strict(v.scenarioListSchema, 'query'),
    asyncHandler(controller.listScenarios),
);
adminRouter.post(
    '/scenarios',
    strict(v.scenarioCreateSchema),
    asyncHandler(controller.createScenario),
);
adminRouter.get(
    '/scenarios/:id',
    strict(v.scenarioIdParamsSchema, 'params'),
    asyncHandler(controller.getScenario),
);
adminRouter.patch(
    '/scenarios/:id',
    strict(v.scenarioIdParamsSchema, 'params'),
    strict(v.scenarioUpdateSchema),
    asyncHandler(controller.updateScenario),
);
adminRouter.post(
    '/scenarios/:id/publish',
    strict(v.scenarioIdParamsSchema, 'params'),
    strict(v.scenarioPublishSchema),
    asyncHandler(controller.publishScenario),
);

adminRouter.post(
    '/inputs/manual',
    strict(v.manualInputSchema),
    asyncHandler(controller.submitManualInput),
);
adminRouter.post(
    '/sources/:id/collect',
    testConnectionLimiter,
    strict(v.sourceIdParamsSchema, 'params'),
    asyncHandler(controller.collectSource),
);
adminRouter.get('/inputs', strict(v.inputListSchema, 'query'), asyncHandler(controller.listInputs));
adminRouter.get(
    '/inputs/:id',
    strict(v.inputIdParamsSchema, 'params'),
    asyncHandler(controller.getInput),
);

module.exports = { adminRouter };
