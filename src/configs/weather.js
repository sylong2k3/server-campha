'use strict';

/**
 * Kết nối tới các API thời tiết ngoài (chỉ cấu hình client, không có logic
 * nghiệp vụ/cache — xem src/utils/openweather.client.js).
 *
 *   - OpenWeather : current weather (point) + tile raster.
 *   - Open-Meteo  : lưới gió (wind grid), không cần key.
 */

require('dotenv').config();

const OPENWEATHER_API_KEY  = process.env.OPENWEATHER_API_KEY || '';
const OPENWEATHER_BASE_URL = process.env.OPENWEATHER_BASE_URL || 'https://api.openweathermap.org/data/2.5';
const OPENWEATHER_TILE_URL = process.env.OPENWEATHER_TILE_URL || 'https://tile.openweathermap.org/map';
const OPEN_METEO_URL       = process.env.OPEN_METEO_URL || 'https://api.open-meteo.com/v1/forecast';

const HTTP_TIMEOUT_MS = parseInt(process.env.WEATHER_HTTP_TIMEOUT_MS, 10) || 10000;
const UNITS = process.env.WEATHER_UNITS || 'metric'; // metric → °C, m/s
const LANG  = process.env.WEATHER_LANG || 'vi';

// Kích thước lưới gió mặc định (NxN điểm). Giới hạn để tránh quá nhiều điểm gọi Open-Meteo.
const WIND_GRID_SIZE = parseInt(process.env.WEATHER_WIND_GRID_SIZE, 10) || 8;
const WIND_GRID_MAX  = parseInt(process.env.WEATHER_WIND_GRID_MAX, 10) || 16;

// OpenWeather cần API key; Open-Meteo (wind grid) thì không.
const isOpenWeatherConfigured = () => Boolean(OPENWEATHER_API_KEY);

module.exports = {
    OPENWEATHER_API_KEY,
    OPENWEATHER_BASE_URL,
    OPENWEATHER_TILE_URL,
    OPEN_METEO_URL,
    HTTP_TIMEOUT_MS,
    UNITS,
    LANG,
    WIND_GRID_SIZE,
    WIND_GRID_MAX,
    isOpenWeatherConfigured,
};
