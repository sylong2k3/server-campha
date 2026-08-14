'use strict';
const { Router } = require('express');
const asyncHandler = require('../helpers/async-handler');
const controller = require('../controllers/map-proxy.controller');
const { optionalAuth } = require('../middlewares/auth.middleware');
const { requireLayerAccess } = require('../middlewares/layer-access.middleware');
const { validate } = require('../middlewares/validate.middleware');
const {
    layerIdParamsSchema,
    wmsQuerySchema,
    wfsQuerySchema,
    wcsQuerySchema,
    tileTicketQuerySchema,
} = require('../validators/map-proxy.validator');
const router = Router();
router.use(optionalAuth);
router.get(
    '/layers/:layerId/wms',
    validate(layerIdParamsSchema, 'params'),
    validate(wmsQuerySchema, 'query'),
    requireLayerAccess('view'),
    asyncHandler(controller.wms),
);
router.get(
    '/layers/:layerId/wfs',
    validate(layerIdParamsSchema, 'params'),
    validate(wfsQuerySchema, 'query'),
    requireLayerAccess('export'),
    asyncHandler(controller.wfs),
);
router.get(
    '/layers/:layerId/wcs',
    validate(layerIdParamsSchema, 'params'),
    validate(wcsQuerySchema, 'query'),
    requireLayerAccess('export'),
    asyncHandler(controller.wcs),
);
router.get(
    '/layers/:layerId/tile-ticket',
    validate(layerIdParamsSchema, 'params'),
    validate(tileTicketQuerySchema, 'query'),
    (req, res, next) => requireLayerAccess(req.query.access)(req, res, next),
    asyncHandler(controller.tileTicket),
);
module.exports = router;
