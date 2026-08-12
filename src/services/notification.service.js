'use strict';

const db = require('../configs/database');
const deviceTokens = require('../repositories/device-token.repository');
const pushProvider = require('../utils/pushProvider.util');

/**
 * Best-effort role broadcast over the existing encrypted device-token store.
 * No notification table is invented: delivery is delegated to the configured
 * push provider and is a safe no-op when FCM is disabled.
 */
const broadcastToRole = async (roleCode, message) => {
    const normalizedRole = String(roleCode || '').trim();
    if (!/^[a-z0-9_]{2,30}$/.test(normalizedRole)) {
        throw new TypeError('Invalid notification role code');
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

module.exports = { broadcastToRole };
