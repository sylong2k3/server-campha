'use strict';

const db = require('../configs/database');
const deviceTokens = require('../repositories/device-token.repository');
const userRepository = require('../repositories/user.repository');
const notificationRepository = require('../repositories/notification.repository');
const pushProvider = require('../utils/pushProvider.util');
const { Api404Error } = require('../core/error.response');

/**
 * Persists a notification row for a single user (their private "my notifications"
 * inbox) and best-effort pushes it over FCM. Safe no-op push when FCM is disabled.
 */
const notifyUser = async (userId, message) => {
    await notificationRepository.createMany([userId], message);
    if (!pushProvider.isAvailable()) {
        return { successCount: 0, failureCount: 0, invalidTokens: [], disabled: true };
    }
    const tokens = await deviceTokens.activeForUser(userId);
    const result = await pushProvider.sendToTokens(tokens, message);
    if (result.invalidTokens.length > 0) {
        await deviceTokens.disableTokens(result.invalidTokens);
    }
    return result;
};

/**
 * Broadcasts a notification to every active user of a role: persists one row per
 * user (so each of them sees it in their own inbox) and best-effort pushes over
 * the existing encrypted device-token store.
 */
const broadcastToRole = async (roleCode, message) => {
    const normalizedRole = String(roleCode || '').trim();
    if (!/^[a-z0-9_]{2,30}$/.test(normalizedRole)) {
        throw new TypeError('Invalid notification role code');
    }

    const userIds = await userRepository.activeIdsByRoles([normalizedRole]);
    if (userIds.length > 0) {
        await notificationRepository.createMany(userIds, message);
    }

    if (!pushProvider.isAvailable()) {
        return { successCount: 0, failureCount: 0, invalidTokens: [], disabled: true };
    }

    const { rows } = await db.query(
        `SELECT dt.token_ciphertext, dt.token_iv, dt.token_auth_tag
           FROM auth.device_tokens dt
           JOIN auth.users u ON u.id = dt.user_id
           JOIN auth.roles r ON r.id = u.role_id
          WHERE r.code = $1
            AND r.is_active = TRUE
            AND u.is_active = TRUE
            AND u.deleted_at IS NULL
            AND dt.disabled_at IS NULL`,
        [normalizedRole],
    );
    const tokens = rows.map(deviceTokens.decrypt);
    const result = await pushProvider.sendToTokens(tokens, message);
    if (result.invalidTokens.length > 0) {
        await deviceTokens.disableTokens(result.invalidTokens);
    }
    return result;
};

const listMine = (userId, filter) => notificationRepository.listForUser(userId, filter);

const unreadCount = (userId) => notificationRepository.countUnread(userId);

const markRead = async (id, userId) => {
    const row = await notificationRepository.markRead(id, userId);
    if (!row) {
        throw new Api404Error('Không tìm thấy thông báo');
    }
    return row;
};

const markAllRead = async (userId) => {
    const updated = await notificationRepository.markAllRead(userId);
    return { updated };
};

module.exports = { broadcastToRole, notifyUser, listMine, unreadCount, markRead, markAllRead };
