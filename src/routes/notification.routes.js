'use strict';
const { Router } = require('express');
const rateLimit = require('express-rate-limit');
const asyncHandler = require('../helpers/async-handler');
const controller = require('../controllers/notification.controller');
const v = require('../validators/notification.validator');
const {
    verifyToken,
    enforcePasswordChange,
    requirePermission,
} = require('../middlewares/auth.middleware');
const { validate } = require('../middlewares/validate.middleware');
const strict = (schema, source = 'body') => validate(schema, source, { stripUnknown: false });
const sendLimiter = rateLimit({
    windowMs: 5 * 60 * 1000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => `user:${req.user.id}`,
});
const router = Router();
router.use(verifyToken, enforcePasswordChange);
router.post(
    '/send',
    requirePermission('notifications', 'send'),
    sendLimiter,
    strict(v.sendSchema),
    asyncHandler(controller.send),
);
router.get('/mine', strict(v.listSchema, 'query'), asyncHandler(controller.listMine));
router.get('/unread-count', asyncHandler(controller.unreadCount));
router.patch('/read-all', asyncHandler(controller.markAllRead));
router.patch('/:id/read', strict(v.idParamsSchema, 'params'), asyncHandler(controller.markRead));
router.delete('/:id', strict(v.idParamsSchema, 'params'), asyncHandler(controller.remove));
module.exports = router;
