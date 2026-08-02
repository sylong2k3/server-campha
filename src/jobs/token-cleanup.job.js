const cron = require('node-cron');
const tokenRepository = require('../repositories/token.repository');
const systemLogger = require('../utils/systemLogger.util');

const CLEANUP_CRON = process.env.TOKEN_CLEANUP_CRON || '0 * * * *';

let task = null;

const runCleanup = async () => {
    try {
        const result = await tokenRepository.cleanupExpired();
        const message =
            `Dọn token hết hạn: refresh=${result.refreshDeleted} blacklist=${result.blacklistDeleted} ` +
            `reset=${result.resetDeleted} emailVerif=${result.emailVerifDeleted} oauthCode=${result.oauthCodeDeleted}`;
        console.log(`[TOKEN CLEANUP] ${message}`);
        systemLogger.logInfo('token-cleanup', message, result);
    } catch (err) {
        console.error('[TOKEN CLEANUP] Failed:', err.message);
        systemLogger.logError('token-cleanup', `Dọn token hết hạn thất bại: ${err.message}`, {
            stack: err.stack,
        });
    }
};

const start = () => {
    if (task) {
        return;
    }
    if (!cron.validate(CLEANUP_CRON)) {
        console.warn(`[TOKEN CLEANUP] Invalid cron expression "${CLEANUP_CRON}" — job not started`);
        return;
    }
    task = cron.schedule(CLEANUP_CRON, runCleanup, { missedExecutionTolerance: 30000 });
    console.log(`  ✓ Token cleanup job scheduled (${CLEANUP_CRON})`);
};

const stop = () => {
    if (task) {
        task.stop();
        task = null;
    }
};

module.exports = { start, stop, runCleanup };
