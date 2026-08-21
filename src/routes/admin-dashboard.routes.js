'use strict';

const { Router } = require('express');
const asyncHandler = require('../helpers/async-handler');
const controller = require('../controllers/admin-dashboard.controller');
const { verifyToken, enforcePasswordChange } = require('../middlewares/auth.middleware');

const router = Router();
router.use(verifyToken, enforcePasswordChange);
router.get('/overview', asyncHandler(controller.overview));

module.exports = router;
