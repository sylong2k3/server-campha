'use strict';
const db = require('../configs/database');
const websocket = require('./websocket.server');
const repository = require('../repositories/field-report.repository');
const notificationService = require('../services/notification.service');
const systemLogger = require('../utils/systemLogger.util');
// Khớp danh sách reviewer trong field-report.service.js: ai duyệt được phản ánh
// thì nhận thông báo phản ánh mới.
const MANAGER_ROLES = ['system_admin', 'ubnd_tp', 'so_tnmt', 'so_xd'];
const STATUS_LABELS = {
    pending: 'Chờ tiếp nhận',
    under_review: 'Đang xem xét',
    approved: 'Đã phê duyệt',
    rejected: 'Đã từ chối',
    resolved: 'Đã xử lý',
};
let client = null,
    retryTimer = null,
    stopping = false,
    retryMs = 1000,
    pushEnabled = true;
const sanitized = (row, event) => ({
    id: row.id,
    referenceCode: row.reference_code,
    status: row.status,
    event,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
});
const handle = async (raw) => {
    let payload;
    try {
        payload = JSON.parse(raw);
    } catch {
        return;
    }
    if (
        !Number.isInteger(payload.reportId) ||
        !['created', 'status_changed'].includes(payload.event)
    ) {
        return;
    }
    const actorUserId = Number.isInteger(payload.actorUserId) ? payload.actorUserId : null;
    const row = await repository.eventSummary(
        payload.reportId,
        actorUserId,
        typeof payload.status === 'string' ? payload.status : null,
        typeof payload.previousStatus === 'string' ? payload.previousStatus : null,
    );
    if (!row) {
        return;
    }
    const status = typeof payload.status === 'string' ? payload.status : row.status;
    const data = {
        ...sanitized({ ...row, status }, payload.event),
        actorRole: row.actor_role || null,
    };
    MANAGER_ROLES.forEach((role) => websocket.notifyChannel(`role:${role}`, 'field_report', data));
    websocket.notifyUser(row.sender_user_id, 'field_report', data);
    if (!pushEnabled) {
        return;
    }

    const notificationData = {
        reportId: row.id,
        referenceCode: row.reference_code,
        status,
        actorRole: row.actor_role || null,
    };
    if (payload.event === 'status_changed') {
        await notificationService.notifyUsersAndRoles([row.sender_user_id], MANAGER_ROLES, {
            type: 'field_report_status_changed',
            title: 'Cập nhật phản ánh Cẩm Phả',
            body: `Phản ánh ${row.reference_code}: ${STATUS_LABELS[status] || status}`,
            data: notificationData,
            eventKey: row.history_id
                ? `field_report:${row.id}:history:${row.history_id}`
                : `field_report:${row.id}:status:${status}`,
        });
    }
    if (payload.event === 'created') {
        await notificationService.broadcastToRoles(MANAGER_ROLES, {
            type: 'field_report_created',
            title: 'Phản ánh Cẩm Phả mới',
            body: `Có phản ánh mới ${row.reference_code} cần xử lý`,
            data: notificationData,
            eventKey: `field_report:${row.id}:created`,
        });
    }
};
const scheduleRetry = () => {
    if (stopping || retryTimer) {
        return;
    }
    retryTimer = setTimeout(() => {
        retryTimer = null;
        start({ sendPush: pushEnabled }).catch(() => scheduleRetry());
    }, retryMs);
    retryTimer.unref?.();
    retryMs = Math.min(retryMs * 2, 30000);
};
const start = async (options = {}) => {
    if (client || stopping) {
        return;
    }
    pushEnabled = options.sendPush !== false;
    let next = null;
    try {
        next = await db.getClient();
        client = next;
        client.on('notification', (message) => {
            if (message.channel === 'field_report_events') {
                handle(message.payload).catch((error) =>
                    systemLogger.logError('field_report_realtime', 'Event handling failed', {
                        code: error.code,
                    }),
                );
            }
        });
        client.on('error', (error) => {
            systemLogger.logError('field_report_realtime', 'PostgreSQL listener failed', {
                code: error.code,
            });
            if (client === next) {
                client = null;
            }
            next.release(true);
            scheduleRetry();
        });
        await client.query('LISTEN field_report_events');
        retryMs = 1000;
        systemLogger.logInfo('field_report_realtime', 'PostgreSQL listener started', {
            pushEnabled,
        });
    } catch (error) {
        client = null;
        if (next) {
            next.release(true);
        }
        systemLogger.logWarn('field_report_realtime', 'PostgreSQL listener unavailable', {
            code: error.code,
        });
        scheduleRetry();
    }
};
const stop = async () => {
    stopping = true;
    if (retryTimer) {
        clearTimeout(retryTimer);
        retryTimer = null;
    }
    if (client) {
        const current = client;
        client = null;
        await current.query('UNLISTEN field_report_events').catch(() => {});
        current.release();
    }
};
module.exports = { start, stop, handle, sanitized };
