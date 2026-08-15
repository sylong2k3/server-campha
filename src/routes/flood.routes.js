'use strict';

const { Router } = require('express');
const asyncHandler = require('../helpers/async-handler');
const controller = require('../controllers/flood.controller');
const validator = require('../validators/flood.validator');
const { validate } = require('../middlewares/validate.middleware');
const {
    verifyToken,
    enforcePasswordChange,
    requirePermission,
} = require('../middlewares/auth.middleware');

const strict = (schema, source = 'body') => validate(schema, source, { stripUnknown: false });

const publicRouter = Router();
publicRouter.get('/overview', asyncHandler(controller.overview));
publicRouter.get('/legends', asyncHandler(controller.legends));
publicRouter.get(
    '/layers',
    strict(validator.publicListSchema, 'query'),
    asyncHandler(controller.layers),
);
publicRouter.get(
    '/runs',
    strict(validator.publicListSchema, 'query'),
    asyncHandler(controller.publicRuns),
);
// Kịch bản dự báo (trực tiếp không dùng GEE): nhập lượng mưa (mm) + thuỷ triều (m, tùy chọn)
publicRouter.post(
    '/forecast/scenario',
    asyncHandler(controller.forecastScenario),
);

const adminRouter = Router();
adminRouter.use(verifyToken, enforcePasswordChange);
adminRouter.get(
    '/dashboard',
    requirePermission('flood', 'read'),
    asyncHandler(controller.dashboard),
);
adminRouter.get('/config', requirePermission('flood', 'read'), asyncHandler(controller.config));
adminRouter.get('/queue', requirePermission('flood', 'read'), asyncHandler(controller.queue));
adminRouter.get(
    '/runs',
    requirePermission('flood', 'read'),
    strict(validator.listSchema, 'query'),
    asyncHandler(controller.listRuns),
);
adminRouter.get(
    '/runs/:id',
    requirePermission('flood', 'read'),
    strict(validator.idParamsSchema, 'params'),
    asyncHandler(controller.getRun),
);
adminRouter.post(
    '/runs',
    requirePermission('flood', 'run'),
    strict(validator.submitSchema),
    asyncHandler(controller.submit),
);
adminRouter.post(
    '/runs/:id/rerun',
    requirePermission('flood', 'run'),
    strict(validator.idParamsSchema, 'params'),
    asyncHandler(controller.rerun),
);
adminRouter.post(
    '/runs/:id/cancel',
    requirePermission('flood', 'run'),
    strict(validator.idParamsSchema, 'params'),
    asyncHandler(controller.cancel),
);
adminRouter.post(
    '/artifacts/:id/publish',
    requirePermission('flood', 'publish'),
    strict(validator.idParamsSchema, 'params'),
    asyncHandler(controller.publishArtifact),
);
adminRouter.post(
    '/artifacts/:id/unpublish',
    requirePermission('flood', 'publish'),
    strict(validator.idParamsSchema, 'params'),
    asyncHandler(controller.unpublishArtifact),
);
// Auto-fill for the M3 rainfall form.
adminRouter.get(
    '/weather/current',
    requirePermission('flood', 'read'),
    asyncHandler(controller.currentWeather),
);
// Manual "fire the daily cron now" — same guard as run submit.
adminRouter.post(
    '/daily/trigger',
    requirePermission('flood', 'run'),
    asyncHandler(controller.triggerDaily),
);
// Kịch bản dự báo: nhập lượng mưa + thuỷ triều → lớp phủ dự báo (M6).
adminRouter.post(
    '/forecast/scenario',
    requirePermission('flood', 'read'),
    asyncHandler(controller.forecastScenario),
);

module.exports = { publicRouter, adminRouter };
