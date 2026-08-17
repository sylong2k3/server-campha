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
publicRouter.get(
    '/legends',
    strict(validator.legendQuerySchema, 'query'),
    asyncHandler(controller.legends),
);
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
publicRouter.get(
    '/simulation',
    strict(validator.simulationSchema, 'query'),
    asyncHandler(controller.simulation),
);
publicRouter.post(
    '/simulation',
    strict(validator.simulationSchema, 'body'),
    asyncHandler(controller.simulation),
);
publicRouter.get(
    '/scenarios',
    strict(validator.queryScenarioSchema, 'query'),
    asyncHandler(controller.listScenarios),
);
publicRouter.get(
    '/scenarios/:id',
    strict(validator.idParamsSchema, 'params'),
    asyncHandler(controller.getScenario),
);

const adminRouter = Router();
adminRouter.use(verifyToken, enforcePasswordChange);
adminRouter.get(
    '/scenarios',
    requirePermission('flood', 'read'),
    strict(validator.queryScenarioSchema, 'query'),
    asyncHandler(controller.listScenarios),
);
adminRouter.get(
    '/scenarios/:id',
    requirePermission('flood', 'read'),
    strict(validator.idParamsSchema, 'params'),
    asyncHandler(controller.getScenario),
);
adminRouter.post(
    '/scenarios',
    requirePermission('flood', 'run'),
    strict(validator.createScenarioSchema, 'body'),
    asyncHandler(controller.createScenario),
);
adminRouter.put(
    '/scenarios/:id',
    requirePermission('flood', 'run'),
    strict(validator.idParamsSchema, 'params'),
    strict(validator.updateScenarioSchema, 'body'),
    asyncHandler(controller.updateScenario),
);
adminRouter.delete(
    '/scenarios/:id',
    requirePermission('flood', 'run'),
    strict(validator.idParamsSchema, 'params'),
    asyncHandler(controller.deleteScenario),
);
adminRouter.get(
    '/dashboard',
    requirePermission('flood', 'read'),
    asyncHandler(controller.dashboard),
);
adminRouter.get('/config', requirePermission('flood', 'read'), asyncHandler(controller.config));
adminRouter.get('/trend/config', requirePermission('flood', 'read'), asyncHandler(controller.trendConfig));
adminRouter.put('/trend/config', requirePermission('flood', 'run'), asyncHandler(controller.updateTrendConfig));
adminRouter.delete('/trend/config/:key', requirePermission('flood', 'run'), asyncHandler(controller.resetTrendConfig));
adminRouter.delete('/trend/config', requirePermission('flood', 'run'), asyncHandler(controller.resetTrendConfig));
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
adminRouter.get(
    '/legends',
    requirePermission('flood', 'read'),
    strict(validator.legendQuerySchema, 'query'),
    asyncHandler(controller.adminLegends),
);
adminRouter.put(
    '/legends/:code',
    requirePermission('flood', 'publish'),
    strict(validator.legendCodeParamsSchema, 'params'),
    strict(validator.updateLegendSchema),
    asyncHandler(controller.updateLegend),
);
adminRouter.delete(
    '/legends/:code',
    requirePermission('flood', 'publish'),
    strict(validator.legendCodeParamsSchema, 'params'),
    asyncHandler(controller.resetLegend),
);

// Manual "fire the daily cron now" — same guard as run submit.
adminRouter.post(
    '/daily/trigger',
    requirePermission('flood', 'run'),
    asyncHandler(controller.triggerDaily),
);

module.exports = { publicRouter, adminRouter };
