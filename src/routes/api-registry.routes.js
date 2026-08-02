'use strict';
const { Router } = require('express'),
    asyncHandler = require('../helpers/async-handler'),
    controller = require('../controllers/api-registry.controller'),
    v = require('../validators/api-registry.validator');
const {
        verifyToken,
        enforcePasswordChange,
        requirePermission,
    } = require('../middlewares/auth.middleware'),
    { validate } = require('../middlewares/validate.middleware');
const router = Router(),
    strict = (schema, source = 'body') => validate(schema, source, { stripUnknown: false });
router.use(verifyToken, enforcePasswordChange);
router.get(
    '/',
    requirePermission('api_registry', 'read'),
    strict(v.listQuery, 'query'),
    asyncHandler(controller.list),
);
router.post(
    '/',
    requirePermission('api_registry', 'create'),
    strict(v.registryBody),
    asyncHandler(controller.create),
);
router.get(
    '/:registryId',
    requirePermission('api_registry', 'read'),
    strict(v.registryParams, 'params'),
    asyncHandler(controller.get),
);
router.put(
    '/:registryId',
    requirePermission('api_registry', 'create'),
    strict(v.registryParams, 'params'),
    strict(v.registryUpdate),
    asyncHandler(controller.update),
);
router.delete(
    '/:registryId',
    requirePermission('api_registry', 'create'),
    strict(v.registryParams, 'params'),
    strict(v.deleteQuery, 'query'),
    asyncHandler(controller.remove),
);
router.get(
    '/:registryId/keys',
    requirePermission('api_registry', 'read'),
    strict(v.registryParams, 'params'),
    asyncHandler(controller.keys),
);
router.post(
    '/:registryId/keys',
    requirePermission('api_registry', 'share'),
    strict(v.registryParams, 'params'),
    strict(v.keyBody),
    asyncHandler(controller.issue),
);
router.post(
    '/keys/:keyId/revoke',
    requirePermission('api_registry', 'share'),
    strict(v.keyParams, 'params'),
    asyncHandler(controller.revoke),
);
router.post(
    '/keys/:keyId/rotate',
    requirePermission('api_registry', 'share'),
    strict(v.keyParams, 'params'),
    strict(v.rotateBody),
    asyncHandler(controller.rotate),
);
router.get(
    '/:registryId/usage',
    requirePermission('api_registry', 'read'),
    strict(v.registryParams, 'params'),
    strict(v.usageQuery, 'query'),
    asyncHandler(controller.usage),
);
module.exports = router;
