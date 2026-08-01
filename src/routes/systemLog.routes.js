const { Router } = require('express');
const asyncHandler = require('../helpers/async-handler');
const systemLogController = require('../controllers/systemLog.controller');
const { verifyToken, requirePermission, enforcePasswordChange } = require('../middlewares/auth.middleware');
const { validate } = require('../middlewares/validate.middleware');
const { listSystemLogsSchema, cleanupSystemLogsSchema } = require('../validators/systemLog.validator');

const adminRouter = Router();

// GET /admin/system-logs — danh sách log hệ thống (lọc theo level/source/từ khóa/khoảng thời gian)
adminRouter.get(
    '/',
    verifyToken,
    enforcePasswordChange,
    requirePermission('system_logs', 'read'),
    validate(listSystemLogsSchema, 'query'),
    asyncHandler(systemLogController.listSystemLogs)
);

// DELETE /admin/system-logs/cleanup — dọn log cũ hơn N ngày
adminRouter.delete(
    '/cleanup',
    verifyToken,
    enforcePasswordChange,
    requirePermission('system_logs', 'manage'),
    validate(cleanupSystemLogsSchema),
    asyncHandler(systemLogController.cleanupSystemLogs)
);

module.exports = { adminRouter };
