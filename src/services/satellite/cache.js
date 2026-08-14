'use strict';

const crypto = require('crypto');
const { Api400Error, Api503Error } = require('../../core/error.response');

const LEGENDS = Object.freeze({
    rgb: [],
    ndvi: [
        { value: -1, label: 'Ít thực vật', color: '#a6611a' },
        { value: 0.2, label: 'Thực vật thưa', color: '#dfc27d' },
        { value: 0.5, label: 'Thực vật', color: '#80cdc1' },
        { value: 0.8, label: 'Thực vật dày', color: '#01665e' },
    ],
    heatmap: [
        { value: 20, label: 'Mát', color: '#313695' },
        { value: 28, label: 'Trung bình', color: '#74add1' },
        { value: 34, label: 'Nóng', color: '#fdae61' },
        { value: 40, label: 'Rất nóng', color: '#a50026' },
    ],
    classified: [
        { value: 0, label: 'Mặt nước / đất trống', color: '#2c7bb6' },
        { value: 1, label: 'Thảm thực vật thưa', color: '#fdae61' },
        { value: 2, label: 'Thảm thực vật', color: '#abdda4' },
        { value: 3, label: 'Rừng / thực vật dày', color: '#1a9850' },
    ],
});

const normalType = (value) => {
    const key = String(value || '').toLowerCase();
    if (key === 'heat-map' || key === 'heat_map') {
        return 'heatmap';
    }
    return key;
};

const assertType = (value) => {
    const type = normalType(value);
    if (!Object.hasOwn(LEGENDS, type)) {
        throw new Api400Error('Loại ảnh vệ tinh không hợp lệ.', ['INVALID_IMAGE_TYPE']);
    }
    return type;
};

const stableSerialize = (value) => {
    if (Array.isArray(value)) {
        return `[${value.map(stableSerialize).join(',')}]`;
    }
    if (value && typeof value === 'object') {
        return `{${Object.keys(value)
            .sort()
            .map((key) => `${JSON.stringify(key)}:${stableSerialize(value[key])}`)
            .join(',')}}`;
    }
    return JSON.stringify(value);
};

const hashRequest = (value) =>
    crypto.createHash('sha256').update(stableSerialize(value)).digest('hex');

const isMissingSatelliteCacheTable = (error) =>
    error?.code === '42P01' && /satellite\.image_results/i.test(String(error?.message || ''));

const requireSatelliteCache = async (operation) => {
    try {
        return await operation();
    } catch (error) {
        if (isMissingSatelliteCacheTable(error)) {
            throw new Api503Error(
                'Kho kết quả ảnh vệ tinh chưa sẵn sàng. Hãy áp dụng migration 087_restore_legacy_satellite.sql.',
                ['SATELLITE_SCHEMA_NOT_READY'],
            );
        }
        throw error;
    }
};

const toResponse = (row, cached) => ({
    resultId: row.id,
    geeTileUrl: row.tile_url,
    geoserverLayer: row.geoserver_layer || null,
    downloadUrl: row.metadata?.downloadUrl || null,
    downloadFilename: row.metadata?.downloadFilename || null,
    stats: row.stats || {},
    legend: row.legend || [],
    metadata: row.metadata || {},
    cached,
});

module.exports = {
    LEGENDS,
    assertType,
    hashRequest,
    isMissingSatelliteCacheTable,
    requireSatelliteCache,
    toResponse,
};
