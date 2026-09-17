'use strict';

/**
 * Cron job tự động cập nhật dự báo thời tiết và lượng mưa 24 giờ lúc 00:00 hàng ngày.
 *
 * Mặc định: 00:00 (Asia/Ho_Chi_Minh).
 * Gọi WeatherAPI để cập nhật dữ liệu 24 giờ của ngày mới vào cache server.
 */

const cron = require('node-cron');
const weatherService = require('../services/flood/weather.service');

let scheduledTask = null;

const readBool = (name, fallback) => {
    const raw = process.env[name];
    if (raw === undefined || raw === null || raw === '') {
        return fallback;
    }
    return String(raw).toLowerCase() === 'true';
};

const settings = () => ({
    enabled: readBool('WEATHER_FORECAST_ENABLED', true),
    expression: process.env.WEATHER_FORECAST_CRON || '0 0 * * *',
    timezone: process.env.WEATHER_FORECAST_CRON_TZ || 'Asia/Ho_Chi_Minh',
});

const runScheduled = async () => {
    try {
        console.info('[WEATHER-FORECAST-JOB] Bắt đầu làm mới dữ liệu dự báo 24 giờ...');
        const data = await weatherService.refreshForecast24h();
        console.info(
            `[WEATHER-FORECAST-JOB] Làm mới dự báo thành công cho ngày ${data.forecastDate} (${data.hours.length} mốc giờ)`,
        );
        return { success: true, forecastDate: data.forecastDate, count: data.hours.length };
    } catch (error) {
        console.error(`[WEATHER-FORECAST-JOB] Làm mới dự báo thất bại: ${error.message}`);
        return { success: false, error: error.message };
    }
};

const start = () => {
    const s = settings();
    if (!s.enabled) {
        console.info('[WEATHER-FORECAST-JOB] scheduler disabled (WEATHER_FORECAST_ENABLED=false)');
        return { started: false, reason: 'DISABLED' };
    }
    if (scheduledTask) {
        return { started: false, reason: 'ALREADY_STARTED' };
    }
    if (!cron.validate(s.expression)) {
        console.error(`[WEATHER-FORECAST-JOB] invalid WEATHER_FORECAST_CRON: ${s.expression}`);
        return { started: false, reason: 'INVALID_CRON' };
    }

    scheduledTask = cron.schedule(s.expression, runScheduled, { timezone: s.timezone });
    console.info(`[WEATHER-FORECAST-JOB] scheduler started (${s.expression} @ ${s.timezone})`);
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
