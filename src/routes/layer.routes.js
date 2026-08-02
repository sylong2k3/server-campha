'use strict';

const { Router } = require('express');
const asyncHandler = require('../helpers/async-handler');
const controller = require('../controllers/layer.controller');
const {
    verifyToken,
    enforcePasswordChange,
    requirePermission,
} = require('../middlewares/auth.middleware');
const { validate } = require('../middlewares/validate.middleware');
const validator = require('../validators/layer.validator');

const router = Router();
const strict = (schema, source = 'body') => validate(schema, source, { stripUnknown: false });
router.use(verifyToken, enforcePasswordChange);

router.post(
    '/imports/shapefile',
    requirePermission('layers', 'create'),
    strict(validator.shapefileImportSchema),
    asyncHandler(controller.enqueueShapefile),
);
router.post(
    '/imports/excel',
    requirePermission('layers', 'create'),
    strict(validator.excelImportSchema),
    asyncHandler(controller.enqueueExcel),
);
router.get(
    '/imports/:jobId',
    requirePermission('layers', 'read'),
    validate(validator.jobIdParamsSchema, 'params'),
    asyncHandler(controller.getImport),
);
router.get(
    '/imports/:jobId/errors',
    requirePermission('layers', 'read'),
    validate(validator.jobIdParamsSchema, 'params'),
    strict(validator.paginationSchema, 'query'),
    asyncHandler(controller.listImportErrors),
);

router.get(
    '/',
    requirePermission('layers', 'read'),
    strict(validator.listLayersSchema, 'query'),
    asyncHandler(controller.listLayers),
);
router.get(
    '/:layerId/standard-metadata.xml',
    requirePermission('layers', 'read'),
    validate(validator.layerIdParamsSchema, 'params'),
    asyncHandler(controller.getStandardMetadataXml),
);
router.get(
    '/:layerId/standard-metadata',
    requirePermission('layers', 'read'),
    validate(validator.layerIdParamsSchema, 'params'),
    asyncHandler(controller.getStandardMetadata),
);
router.put(
    '/:layerId/standard-metadata',
    requirePermission('layers', 'update'),
    validate(validator.layerIdParamsSchema, 'params'),
    strict(validator.geographicMetadataSchema),
    asyncHandler(controller.updateStandardMetadata),
);
router.get(
    '/:layerId',
    requirePermission('layers', 'read'),
    validate(validator.layerIdParamsSchema, 'params'),
    asyncHandler(controller.getLayer),
);
router.patch(
    '/:layerId',
    requirePermission('layers', 'update'),
    validate(validator.layerIdParamsSchema, 'params'),
    strict(validator.layerUpdateSchema),
    asyncHandler(controller.updateLayer),
);
router.put(
    '/:layerId/permissions',
    requirePermission('layers', 'grant'),
    validate(validator.layerIdParamsSchema, 'params'),
    strict(validator.permissionsSchema),
    asyncHandler(controller.replacePermissions),
);
router.post(
    '/:layerId/publish',
    requirePermission('layers', 'update'),
    validate(validator.layerIdParamsSchema, 'params'),
    asyncHandler(controller.retryPublish),
);
router.delete(
    '/:layerId',
    requirePermission('layers', 'delete'),
    validate(validator.layerIdParamsSchema, 'params'),
    strict(validator.deleteLayerSchema),
    asyncHandler(controller.deleteLayer),
);

module.exports = router;
