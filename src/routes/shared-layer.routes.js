'use strict';
const { Router } = require('express'),
    asyncHandler = require('../helpers/async-handler'),
    controller = require('../controllers/shared-layer.controller'),
    v = require('../validators/shared-layer.validator'),
    auth = require('../middlewares/shared-api.middleware'),
    { validate } = require('../middlewares/validate.middleware');
const router = Router(),
    strict = (schema, source = 'body') => validate(schema, source, { stripUnknown: false });
router.use(auth.authenticate);
router.get(
    '/:slug/features',
    strict(v.slug, 'params'),
    strict(v.list, 'query'),
    asyncHandler(controller.list),
);
router.get('/:slug/features/:featureId', strict(v.feature, 'params'), asyncHandler(controller.get));
router.post(
    '/:slug/features',
    strict(v.slug, 'params'),
    strict(v.create),
    asyncHandler(controller.create),
);
router.put(
    '/:slug/features/:featureId',
    strict(v.feature, 'params'),
    strict(v.update),
    asyncHandler(controller.update),
);
router.delete(
    '/:slug/features/:featureId',
    strict(v.feature, 'params'),
    strict(v.remove),
    asyncHandler(controller.remove),
);
module.exports = router;
