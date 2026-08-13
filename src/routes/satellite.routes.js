'use strict';

const { Router } = require('express');
const asyncHandler = require('../helpers/async-handler');
const controller = require('../controllers/satellite.controller');
const { optionalAuth, verifyToken, requirePermission } = require('../middlewares/auth.middleware');

const router = Router();

router.post('/rgb', optionalAuth, asyncHandler(controller.getRgb));
router.post('/ndvi', optionalAuth, asyncHandler(controller.getNdvi));
router.post('/heat-map', optionalAuth, asyncHandler(controller.getHeatmap));
router.post('/classified', optionalAuth, asyncHandler(controller.getClassified));
router.post('/fire-risk', optionalAuth, asyncHandler(controller.getFireRisk));
router.post('/publish', verifyToken, requirePermission('satellite', 'manage'), asyncHandler(controller.publishToGeoServer));
router.post('/results/:id/publish-raster', verifyToken, requirePermission('map_layers', 'ingest_raster'), asyncHandler(controller.publishToRaster));

module.exports = router;
