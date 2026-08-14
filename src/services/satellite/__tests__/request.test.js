'use strict';

const { Api400Error } = require('../../../core/error.response');
const { normalizeRequest } = require('../request');
const { CAM_PHA_GEOMETRY } = require('../geometry');

const dates = { startDate: '2026-01-01', endDate: '2026-01-31' };

describe('satellite request normalization', () => {
    test('keeps the legacy exclusive end date and accepts client L8/L9 values', () => {
        const result = normalizeRequest('ndvi', {
            ...dates,
            collection: 'L8',
            ndviMinThresh: 0.45,
        });

        expect(result.collection).toBe('L8');
        expect(result.productVersion).toBe('optical-rg-clip-v3');
        expect(result.endDate).toBe('2026-01-31');
        expect(result.ndviMinThresh).toBe(0.45);
    });

    test('normalizes supported collection aliases and defaults the NDVI threshold', () => {
        expect(normalizeRequest('rgb', { ...dates, collection: 'sentinel 2' }).collection).toBe('S2');
        expect(normalizeRequest('rgb', { ...dates, collection: 'landsat' }).collection).toBe(
            'LANDSAT',
        );
        expect(normalizeRequest('ndvi', dates).ndviMinThresh).toBe(0.3);
    });

    test('uses cp_rg.geojson as the clipping geometry when none is supplied', () => {
        const result = normalizeRequest('rgb', dates);

        expect(result.geometry).toEqual(CAM_PHA_GEOMETRY);
        expect(result.geometrySource).toBe('cp_rg.geojson');
    });

    test('versions the thermal product to invalidate MODIS cache entries', () => {
        expect(normalizeRequest('heatmap', dates).productVersion).toBe('modis-lst-rg-clip-v4');
    });

    test('rejects an unsupported collection and NDVI threshold', () => {
        expect(() => normalizeRequest('rgb', { ...dates, collection: 'planet' })).toThrow(Api400Error);
        expect(() => normalizeRequest('ndvi', { ...dates, ndviMinThresh: 1.1 })).toThrow(
            Api400Error,
        );
    });
});
