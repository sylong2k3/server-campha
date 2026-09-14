'use strict';

const cron = require('node-cron');
const notificationService = require('../services/notification.service');
const systemLogger = require('../utils/systemLogger.util');

const CLEANUP_CRON = process.env.NOTIFICATION_CLEANUP_CRON || '30 3 * * *';
const RETENTION_DAYS = Math.max(7, Number(process.env.NOTIFICATION_RETENTION_DAYS) || 90);

let task = null;

const runCleanup = async () => {
    try {
        const deletedCount = await notificationService.cleanupOld(RETENTION_DAYS);
        const message = `Dọn dẹp thông báo cũ: đã xoá ${deletedCount} bản ghi quá ${RETENTION_DAYS} ngày`;
        console.log(`[NOTIFICATION CLEANUP] ${message}`);
        systemLogger.logInfo('notification-cleanup', message, { deletedCount, retentionDays: RETENTION_DAYS });
        return { deletedCount };
    } catch (err) {
        console.error('[NOTIFICATION CLEANUP] Failed:', err.message);
        systemLogger.logError('notification-cleanup', `Dọn dẹp thông báo cũ thất bại: ${err.message}`, {
            stack: err.stack,
        });
        return { error: err.message };
    }
};

const start = () => {
    if (task) {
        return;
    }
    if (!cron.validate(CLEANUP_CRON)) {
        console.warn(`[NOTIFICATION CLEANUP] Invalid cron expression "${CLEANUP_CRON}" — job not started`);
        return;
    }
    task = cron.schedule(CLEANUP_CRON, runCleanup, { missedExecutionTolerance: 30000 });
    console.log(`  ✓ Notification cleanup job scheduled (${CLEANUP_CRON}, retention=${RETENTION_DAYS}d)`);
};

const stop = () => {
    if (task) {
        task.stop();
        task = null;
    }
};

module.exports = { start, stop, runCleanup };
