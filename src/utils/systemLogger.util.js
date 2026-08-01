const systemLogRepository = require('../repositories/systemLog.repository');

/**
 * Fire-and-forget wrapper quanh systemLogRepository.create — nuốt lỗi (chỉ
 * console.error) vì ghi log hệ thống không bao giờ được làm crash tiến trình
 * hay chặn luồng xử lý chính (giống activityLogger.util.js nhưng cho sự kiện
 * tầng hệ thống thay vì hành vi người dùng). Không tự console.log ở nhánh
 * thành công — nơi gọi đã tự in log theo định dạng riêng, tránh in trùng lặp.
 */
const writeLog = async (level, source, message, metadata) => {
    try {
        await systemLogRepository.create({ level, source, message, metadata });
    } catch (err) {
        console.error(`[SYSTEM LOG] Ghi log thất bại (${source}):`, err.message);
    }
};

const logDebug = (source, message, metadata) => writeLog('debug', source, message, metadata);
const logInfo = (source, message, metadata) => writeLog('info', source, message, metadata);
const logWarn = (source, message, metadata) => writeLog('warn', source, message, metadata);
const logError = (source, message, metadata) => writeLog('error', source, message, metadata);

module.exports = { logDebug, logInfo, logWarn, logError };
