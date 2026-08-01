const systemLogRepository = require('../repositories/systemLog.repository');
const activityLogger = require('../utils/activityLogger.util');
const { t } = require('../utils/i18n.util');

const listSystemLogs = async (filter) => {
    const { items, total } = await systemLogRepository.findAll(filter);
    return { items, total };
};

const cleanupSystemLogs = async (olderThanDays, actor) => {
    const deleted = await systemLogRepository.deleteOlderThan(olderThanDays);
    await activityLogger.logActivity('[SYSTEM LOG]', {
        userId: actor.id,
        action: 'system_logs_cleanup',
        ipAddress: actor.ipAddress,
        userAgent: actor.userAgent,
        metadata: { olderThanDays, deleted },
    });
    return { deleted, message: t('system_logs_cleaned_success', actor.lang, { count: deleted }) };
};

module.exports = { listSystemLogs, cleanupSystemLogs };
