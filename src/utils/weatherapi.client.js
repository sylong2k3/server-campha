'use strict';

/**
 * Client kết nối tới WeatherAPI (https://api.weatherapi.com/v1)
 * Lấy dự báo 24 giờ trong ngày phục vụ tính toán kịch bản ngập KTTV Cẩm Phả.
 */

const cfg = require('../configs/weather');

const fetchWithTimeout = async (url, { timeoutMs = cfg.HTTP_TIMEOUT_MS, ...opts } = {}) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await fetch(url, { signal: controller.signal, ...opts });
    } finally {
        clearTimeout(timer);
    }
};

/**
 * Gọi endpoint /forecast.json của WeatherAPI và chuẩn hóa danh sách 24 giờ.
 *
 * @param {number} lat Vĩ độ
 * @param {number} lon Kinh độ
 * @param {string} lang Ngôn ngữ (mặc định 'vi')
 */
const getHourlyForecast = async (lat, lon, lang = cfg.LANG || 'vi') => {
    if (!cfg.isWeatherApiConfigured()) {
        const err = new Error('WeatherAPI API key chưa được cấu hình (thiếu VITE_WEATHERAPI_API_KEY)');
        err.code = 'WEATHERAPI_NOT_CONFIGURED';
        throw err;
    }

    const url = new URL(`${cfg.WEATHERAPI_URL_BASE.replace(/\/$/, '')}/forecast.json`);
    url.searchParams.set('key', cfg.WEATHERAPI_API_KEY);
    url.searchParams.set('q', `${lat},${lon}`);
    url.searchParams.set('days', '1');
    url.searchParams.set('aqi', 'no');
    url.searchParams.set('alerts', 'no');
    url.searchParams.set('lang', lang);

    const res = await fetchWithTimeout(url.toString());
    if (!res.ok) {
        let errDetail = '';
        try {
            const body = await res.json();
            errDetail = body?.error?.message || '';
        } catch {
            errDetail = await res.text().catch(() => '');
        }
        // Không để lộ API key trong log lỗi
        const safeDetail = String(errDetail).replace(new RegExp(cfg.WEATHERAPI_API_KEY, 'g'), '[REDACTED]');
        const error = new Error(`WeatherAPI upstream lỗi ${res.status}: ${safeDetail.slice(0, 200)}`);
        error.status = res.status;
        error.code = 'WEATHERAPI_UPSTREAM_ERROR';
        throw error;
    }

    const data = await res.json();
    const day = data?.forecast?.forecastday?.[0];
    if (!day || !Array.isArray(day.hour)) {
        const error = new Error('Dữ liệu dự báo từ WeatherAPI không đúng định dạng mong đợi (thiếu forecastday.hour)');
        error.code = 'WEATHERAPI_MALFORMED_DATA';
        throw error;
    }

    const hours = day.hour.map((h) => ({
        time: h.time, // e.g. "2026-09-18 00:00"
        timeEpoch: h.time_epoch,
        hour: h.time ? h.time.split(' ')[1] : '', // "00:00"
        tempC: h.temp_c,
        feelsLikeC: h.feelslike_c,
        humidity: h.humidity,
        precipMm: Number.isFinite(Number(h.precip_mm)) ? Number(h.precip_mm) : 0,
        chanceOfRain: Number.isFinite(Number(h.chance_of_rain)) ? Number(h.chance_of_rain) : 0,
        condition: {
            text: h.condition?.text || '',
            icon: h.condition?.icon || '',
            code: h.condition?.code || 0,
        },
        windKph: h.wind_kph,
        windDir: h.wind_dir,
        uv: h.uv,
    }));

    return {
        location: {
            name: data.location?.name || 'Cẩm Phả',
            region: data.location?.region || 'Quảng Ninh',
            country: data.location?.country || 'Vietnam',
            lat: data.location?.lat ?? lat,
            lon: data.location?.lon ?? lon,
            localtime: data.location?.localtime || null,
        },
        forecastDate: day.date,
        daySummary: {
            maxTempC: day.day?.maxtemp_c ?? null,
            minTempC: day.day?.mintemp_c ?? null,
            avgTempC: day.day?.avgtemp_c ?? null,
            totalPrecipMm: Number.isFinite(Number(day.day?.totalprecip_mm)) ? Number(day.day.totalprecip_mm) : 0,
            dailyChanceOfRain: Number.isFinite(Number(day.day?.daily_chance_of_rain))
                ? Number(day.day.daily_chance_of_rain)
                : 0,
            condition: {
                text: day.day?.condition?.text || '',
                icon: day.day?.condition?.icon || '',
                code: day.day?.condition?.code || 0,
            },
        },
        hours, // 24 phần tử (00:00 - 23:00)
        source: 'weatherapi',
        fetchedAt: new Date().toISOString(),
    };
};

module.exports = {
    getHourlyForecast,
};
