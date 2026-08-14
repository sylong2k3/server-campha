'use strict';

const { Router } = require('express');
const asyncHandler = require('../helpers/async-handler');
const controller = require('../controllers/forest-classification.controller');
const { optionalAuth, verifyToken, requirePermission } = require('../middlewares/auth.middleware');
const { geeManualTriggerLimiter, geeQueryLimiter } = require('../middlewares/gee-rate-limit.middleware');

const router = Router();

router.get('/latest', optionalAuth, asyncHandler(controller.getLatest));
router.post('/query', optionalAuth, geeQueryLimiter, asyncHandler(controller.queryPeriod));
router.get('/snapshot/:id', optionalAuth, asyncHandler(controller.getSnapshot));
router.get('/published-history', optionalAuth, asyncHandler(controller.getPublishedHistory));

router.get('/history', verifyToken, requirePermission('forest_classification', 'manage'), asyncHandler(controller.getHistory));
router.post('/refresh', verifyToken, requirePermission('forest_classification', 'manage'), geeManualTriggerLimiter, asyncHandler(controller.refresh));
router.post('/snapshots/:id/publish-raster', verifyToken, requirePermission('map_layers', 'ingest_raster'), asyncHandler(controller.publishRaster));

const groundTruth = (handler) => [verifyToken, requirePermission('forest_classification', 'ground_truth'), asyncHandler(handler)];
router.get('/ground-truth/zones', ...groundTruth(controller.listZones));
router.post('/ground-truth/zones', ...groundTruth(controller.createZone));
router.post('/ground-truth/zones/bulk', ...groundTruth(controller.bulkZone));
router.delete('/ground-truth/zones/:id', ...groundTruth(controller.deleteZone));
router.get('/ground-truth/points', ...groundTruth(controller.listPoints));
router.post('/ground-truth/points', ...groundTruth(controller.createPoint));
router.post('/ground-truth/points/bulk', ...groundTruth(controller.bulkPoint));
router.delete('/ground-truth/points/:id', ...groundTruth(controller.deletePoint));

module.exports = router;
