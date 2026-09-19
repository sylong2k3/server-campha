'use strict';

/**
 * Cron job tự động cập nhật kịch bản ngập lụt theo lịch trình dự báo thời tiết.
 *
 * Mặc định: Chạy hàng giờ vào đầu mỗi giờ (0 * * * *), múi giờ Asia/Ho_Chi_Minh.
 * Kiểm tra các mốc giờ tới hạn: nếu có mưa và tỷ lệ mưa > 50% thì tự động cập nhật kịch bản.
 */

const cron = require('node-cron');
const forecastScenarioService = require('../services/flood/forecast-scenario.service');

let scheduledTask = null;

const readBool = (name, fallback) => {
    const raw = process.env[name];
    if (raw === undefined || raw === null || raw === '') {
        return fallback;
    }
    return String(raw).toLowerCase() === 'true';
};

const settings = () => ({
    enabled: readBool('FLOOD_SCENARIO_AUTO_ENABLED', true),
    expression: process.env.FLOOD_SCENARIO_AUTO_CRON || '0 * * * *',
    timezone: process.env.FLOOD_SCENARIO_AUTO_CRON_TZ || 'Asia/Ho_Chi_Minh',
});

const runScheduled = async () => {
    try {
        console.info('[FLOOD-SCENARIO-AUTO-JOB] Bắt đầu kiểm tra các mốc lịch trình dự báo tới hạn...');
        const result = await forecastScenarioService.processDueScheduleSlots();
        console.info(
            `[FLOOD-SCENARIO-AUTO-JOB] Xử lý hoàn tất: ${result.processed} mốc (Áp dụng: ${result.applied}, Bỏ qua: ${result.skipped}, Lỗi: ${result.errors})`,
        );
        return { success: true, ...result };
    } catch (error) {
        console.error(`[FLOOD-SCENARIO-AUTO-JOB] Xử lý tự động kịch bản thất bại: ${error.message}`);
        return { success: false, error: error.message };
    }
};

const start = () => {
    const s = settings();
    if (!s.enabled) {
        console.info('[FLOOD-SCENARIO-AUTO-JOB] scheduler disabled (FLOOD_SCENARIO_AUTO_ENABLED=false)');
        return { started: false, reason: 'DISABLED' };
    }
    if (scheduledTask) {
        return { started: false, reason: 'ALREADY_STARTED' };
    }
    if (!cron.validate(s.expression)) {
        console.error(`[FLOOD-SCENARIO-AUTO-JOB] invalid FLOOD_SCENARIO_AUTO_CRON: ${s.expression}`);
        return { started: false, reason: 'INVALID_CRON' };
    }

    scheduledTask = cron.schedule(s.expression, runScheduled, { timezone: s.timezone });
    console.info(`[FLOOD-SCENARIO-AUTO-JOB] scheduler started (${s.expression} @ ${s.timezone})`);
    return { started: true };
};

const stop = () => {
    if (scheduledTask) {
        scheduledTask.stop();
        scheduledTask = null;
    }
};

const __resetForTests = () => stop();

module.exports = {
    start,
    stop,
    runScheduled,
    settings,
    __resetForTests,
};
