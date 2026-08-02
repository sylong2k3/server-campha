const tokenRepository = require('../repositories/token.repository');

/**
 * Fire-and-forget wrapper quanh tokenRepository.logActivity — nuốt lỗi (chỉ
 * console.error) vì audit log không bao giờ được làm fail request chính.
 * `logPrefix` chỉ để phân biệt nguồn log (VD '[AUTH]', '[USER]').
 */
const logActivity = async (
    logPrefix,
    { userId, action, status = 'success', ipAddress, userAgent, metadata },
) => {
    try {
        await tokenRepository.logActivity({
            userId,
            action,
            status,
            ipAddress,
            userAgent,
            metadata,
        });
    } catch (err) {
        console.error(`${logPrefix} Activity log failed:`, err.message);
    }
};

module.exports = { logActivity };
