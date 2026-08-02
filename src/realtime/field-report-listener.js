'use strict';
const db = require('../configs/database');
const websocket = require('./websocket.server');
const repository = require('../repositories/field-report.repository');
const tokenRepository = require('../repositories/device-token.repository');
const pushProvider = require('../utils/pushProvider.util');
const systemLogger = require('../utils/systemLogger.util');
const MANAGER_ROLES = ['ubnd_tp', 'so_tnmt', 'so_xd'];
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
    const row = await repository.eventSummary(payload.reportId);
    if (!row) {
        return;
    }
    const data = sanitized(row, payload.event);
    MANAGER_ROLES.forEach((role) => websocket.notifyChannel(`role:${role}`, 'field_report', data));
    websocket.notifyUser(row.sender_user_id, 'field_report', data);
    if (pushEnabled && payload.event === 'status_changed') {
        const tokens = await tokenRepository.activeForUser(row.sender_user_id);
        const result = await pushProvider.sendToTokens(tokens, {
            title: 'Phản ánh Cẩm Phả',
            body: `Trạng thái phản ánh ${row.reference_code}: ${row.status}`,
            data: { reportId: row.id, status: row.status },
        });
        await tokenRepository.disableTokens(result.invalidTokens);
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
