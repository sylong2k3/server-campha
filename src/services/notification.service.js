'use strict';

const deviceTokens = require('../repositories/device-token.repository');
const userRepository = require('../repositories/user.repository');
const notificationRepository = require('../repositories/notification.repository');
const pushProvider = require('../utils/pushProvider.util');
const websocket = require('../realtime/websocket.server');
const { Api404Error } = require('../core/error.response');

const disabledPushResult = () => ({
    successCount: 0,
    failureCount: 0,
    invalidTokens: [],
    disabled: true,
});

const withRecipientCount = (result, recipientCount) => ({
    ...result,
    recipientCount,
});

const emitCreated = (rows) => {
    (rows || []).forEach((row) => websocket.notifyUser(row.user_id, 'notification', row));
};

/**
 * Persists one inbox row per unique user and pushes only rows newly inserted.
 * `eventKey` is omitted from public delivery payloads and is used only for DB
 * idempotency. A repeated event therefore emits neither WebSocket nor FCM.
 */
const notifyUsers = async (userIds, message) => {
    const ids = Array.from(new Set(userIds)).filter(Boolean);
    if (!ids.length) {
        return withRecipientCount(disabledPushResult(), 0);
    }
    const rows = await notificationRepository.createMany(ids, message);
    emitCreated(rows);
    if (!rows.length) {
        return withRecipientCount(
            { successCount: 0, failureCount: 0, invalidTokens: [], duplicate: ids.length > 0 },
            0,
        );
    }
    if (!pushProvider.isAvailable()) {
        return withRecipientCount(disabledPushResult(), rows.length);
    }

    const insertedIds = rows.map((row) => row.user_id);
    const tokenRows = await deviceTokens.activeForUsers(insertedIds);
    const tokens = tokenRows.map((row) => row.token);
    const deliveryMessage = {
        type: message.type,
        title: message.title,
        body: message.body,
        data: message.data,
    };
    const result = await pushProvider.sendToTokens(tokens, deliveryMessage);
    if (result.invalidTokens.length > 0) {
        await deviceTokens.disableTokens(result.invalidTokens);
    }
    return withRecipientCount(result, rows.length);
};

const normalizeRoles = (roleCodes) => {
    const roles = Array.from(new Set(roleCodes.map((role) => String(role || '').trim())));
    if (roles.some((role) => !/^[a-z0-9_]{2,30}$/.test(role))) {
        throw new TypeError('Invalid notification role code');
    }
    return roles;
};

const notifyUsersAndRoles = async (userIds, roleCodes, message) => {
    const roles = normalizeRoles(roleCodes);
    const roleUserIds = roles.length ? await userRepository.activeIdsByRoles(roles) : [];
    return notifyUsers([...userIds, ...roleUserIds], message);
};

const notifyUser = (userId, message) => notifyUsers([userId], message);

const broadcastToRoles = (roleCodes, message) => notifyUsersAndRoles([], roleCodes, message);

const broadcastToRole = (roleCode, message) => broadcastToRoles([roleCode], message);

const broadcastToAll = async (message) => {
    const userIds = await userRepository.activeIds();
    return notifyUsers(userIds, message);
};

const sendNotification = async (input, actor) => {
    const message = {
        type: input.type,
        title: input.title,
        body: input.body,
        data: { ...(input.data || {}), channel: input.channel || 'system' },
    };

    if (input.target === 'user') {
        const user = await userRepository.findByIdSafe(input.userId);
        if (!user || user.is_active !== true) {
            throw new Api404Error('Không tìm thấy người dùng đang hoạt động');
        }
        const push = await notifyUser(input.userId, message);
        return {
            target: input.target,
            userId: input.userId,
            recipientCount: push.recipientCount,
            push,
            sentBy: actor.id,
        };
    }

    if (input.target === 'role') {
        const role = await userRepository.findRoleByCode(input.roleCode);
        if (!role) {
            throw new Api404Error('Không tìm thấy vai trò nhận thông báo');
        }
        const push = await broadcastToRole(input.roleCode, message);
        return {
            target: input.target,
            roleCode: input.roleCode,
            recipientCount: push.recipientCount,
            push,
            sentBy: actor.id,
        };
    }

    const push = await broadcastToAll(message);
    return {
        target: input.target,
        recipientCount: push.recipientCount,
        push,
        sentBy: actor.id,
    };
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

const remove = async (id, userId) => {
    const row = await notificationRepository.remove(id, userId);
    if (!row) {
        throw new Api404Error('Không tìm thấy thông báo');
    }
    return row;
};

module.exports = {
    broadcastToRole,
    broadcastToRoles,
    broadcastToAll,
    notifyUser,
    notifyUsers,
    notifyUsersAndRoles,
    sendNotification,
    listMine,
    unreadCount,
    markRead,
    markAllRead,
    remove,
};
