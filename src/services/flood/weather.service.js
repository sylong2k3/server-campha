'use strict';

/**
 * Dịch vụ thời tiết và dự báo lượng mưa 24 giờ cho KTTV Cẩm Phả.
 *
 * Tích hợp WeatherAPI để lấy dự báo theo từng giờ (24 mốc 00:00 - 23:00)
 * của ngày hiện tại, lưu cache trong bộ nhớ và tự động làm mới hàng ngày
 * qua cron job lúc 00:00 (giờ Việt Nam).
 */

const weatherapi = require('../../utils/weatherapi.client');
const openweather = require('../../utils/openweather.client');
const weatherConfig = require('../../configs/weather');
const floodForecastRepo = require('../../repositories/flood-forecast.repository');

const centerCoordinates = () => ({
    lng: Number(process.env.CAMPHA_CENTER_LNG) || 107.303749,
    lat: Number(process.env.CAMPHA_CENTER_LAT) || 21.002361,
});

// Cache dự báo 24 giờ trong bộ nhớ tiến trình
let cachedForecast = null;
let lastFetchedAt = null;
let inFlightPromise = null;

/**
 * Lưu trữ snapshot dự báo và danh sách mốc giờ vào cơ sở dữ liệu.
 */
async function persistForecastData(forecastData) {
    if (!forecastData || !forecastData.forecastDate || !Array.isArray(forecastData.hours)) {
        return null;
    }
    try {
        const snapshot = await floodForecastRepo.saveForecastSnapshot({
            forecastDate: forecastData.forecastDate,
            location: forecastData.location?.name || 'Cam Pha',
            fetchedAt: forecastData.fetchedAt ? new Date(forecastData.fetchedAt) : new Date(),
            hourlyData: forecastData.hours,
        });

        if (snapshot?.id) {
            await floodForecastRepo.createOrUpdateScheduleSlots(
                snapshot.id,
                forecastData.forecastDate,
                forecastData.hours,
            );
        }
        return snapshot;
    } catch (error) {
        console.warn(`[WEATHER-PERSISTENCE] Lưu forecast snapshot/schedule vào DB thất bại: ${error.message}`);
        return null;
    }
}

/**
 * Lấy dự báo 24 giờ từ WeatherAPI hoặc từ cache trong bộ nhớ.
 * Hỗ trợ deduplicate các request gọi đồng thời qua inFlightPromise.
 *
 * @param {Object} options
 * @param {boolean} options.forceRefresh Bắt buộc gọi upstream làm mới cache
 */
async function getForecast24h({ forceRefresh = false } = {}) {
    if (!forceRefresh && cachedForecast) {
        return cachedForecast;
    }

    if (inFlightPromise) {
        return inFlightPromise;
    }

    const { lat, lng } = centerCoordinates();

    inFlightPromise = (async () => {
        try {
            const data = await weatherapi.getHourlyForecast(lat, lng, weatherConfig.LANG || 'vi');
            cachedForecast = data;
            lastFetchedAt = Date.now();

            // Lưu snapshot và lịch trình vào DB (xử lý không đồng bộ để không chặn cache)
            await persistForecastData(data).catch(() => null);

            return cachedForecast;
        } catch (error) {
            // Khi làm mới thất bại, nếu đã có cache cũ thì giữ lại cache cũ, không làm mất dữ liệu
            if (cachedForecast && forceRefresh) {
                console.warn(`[WEATHER-FORECAST] Refresh thất bại, giữ lại cache cũ: ${error.message}`);
            }
            throw error;
        } finally {
            inFlightPromise = null;
        }
    })();

    return inFlightPromise;
}

/**
 * Bắt buộc làm mới dự báo 24 giờ từ WeatherAPI và cập nhật cache.
 */
async function refreshForecast24h() {
    return getForecast24h({ forceRefresh: true });
}

/**
 * Lấy cache hiện tại đồng bộ (nếu có).
 */
function getCachedForecast() {
    return cachedForecast;
}

/**
 * Xóa cache (phục vụ testing).
 */
function __resetCacheForTests() {
    cachedForecast = null;
    lastFetchedAt = null;
    inFlightPromise = null;
}

/**
 * Hàm kế thừa OpenWeather (phục vụ tương thích ngược nếu có module gọi).
 */
async function getCurrentRainfallBundle() {
    if (!weatherConfig.isOpenWeatherConfigured()) {
        const error = new Error('OpenWeather API key not configured');
        error.code = 'OPENWEATHER_NOT_CONFIGURED';
        throw error;
    }
    const { lng, lat } = centerCoordinates();
    const data = await openweather.getCurrentWeather(lng, lat);
    const rain1h = Number.isFinite(data.rain1h) ? Number(data.rain1h) : 0;
    return {
        observedAt: data.observedAt,
        location: data.location,
        coord: data.coord,
        source: 'openweather',
        rainfall: {
            amount1h: rain1h,
            amount3h: null,
            amount6h: null,
            amount24h: null,
            amount72h: null,
            amount7d: null,
            amount30d: null,
        },
        weather: data.weather,
        humidity: data.humidity,
        wind: data.wind,
    };
}

module.exports = {
    getForecast24h,
    refreshForecast24h,
    getCachedForecast,
    centerCoordinates,
    getCurrentRainfallBundle,
    persistForecastData,
    __resetCacheForTests,
};
