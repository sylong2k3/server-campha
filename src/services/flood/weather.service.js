'use strict';

/**
 * Bridge between OpenWeather (point nowcast) and the M3 rainfall form.
 *
 * The admin flood UI has an "Auto-fill from OpenWeather" button on the rain
 * (M3) module. This service exposes the latest reading at the Cẩm Phả center
 * and remaps it into the same field names the form uses so the FE can call
 * one endpoint and set state directly (no per-field wrangling).
 *
 * OpenWeather's free `/data/2.5/weather` only gives:
 *   - `rain.1h` (mm in the last hour, if raining now)
 *   - `rain.3h` (mm in the last 3 hours, if reported)
 * That's enough to seed `amount1h/3h`; longer windows (6h/24h/72h/7d/30d)
 * stay blank and the admin fills them by hand or leaves them for IMERG /
 * CHIRPS. Do not fabricate.
 */

const openweather = require('../../utils/openweather.client');
const weatherConfig = require('../../configs/weather');

const centerCoordinates = () => ({
    lng: Number(process.env.CAMPHA_CENTER_LNG) || 107.303749,
    lat: Number(process.env.CAMPHA_CENTER_LAT) || 21.002361,
});

/**
 * Fetch OpenWeather nowcast for the Cẩm Phả center and reshape it for the
 * rain form. Returns nulls (never zeros) for windows OpenWeather doesn't
 * report so downstream logic can distinguish "no data" from "no rain".
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
    // Some OpenWeather stations report `rain.3h` when they don't report 1h,
    // but the client util currently only surfaces `rain1h`. We propagate rain1h
    // as amount1h and leave 3h+ blank for the operator to fill.
    return {
        observedAt: data.observedAt,
        location: data.location,
        coord: data.coord,
        source: 'openweather',
        // Field names mirror admin/src/pages/Flood/index.tsx buildRunConfig 'rain'.
        rainfall: {
            amount1h: rain1h,
            amount3h: null,
            amount6h: null,
            amount24h: null,
            amount72h: null,
            amount7d: null,
            amount30d: null,
        },
        // Extra context for the UI to show alongside the numbers.
        weather: data.weather,
        humidity: data.humidity,
        wind: data.wind,
    };
}

module.exports = { getCurrentRainfallBundle, centerCoordinates };
