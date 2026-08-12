'use strict';

const BASE_URL = 'https://api.mapbox.com/directions/v5/mapbox';
const DEFAULT_PROFILE = 'driving';
const PROFILES = new Set(['driving', 'walking', 'cycling']);

const token = () => String(process.env.MAPBOX_DIRECTIONS_TOKEN || '').trim();
const timeoutMs = () => {
    const value = Number(process.env.MAPBOX_DIRECTIONS_TIMEOUT_MS || 10000);
    return Number.isInteger(value) && value > 0 ? value : 10000;
};

module.exports = { BASE_URL, DEFAULT_PROFILE, PROFILES, token, timeoutMs };
