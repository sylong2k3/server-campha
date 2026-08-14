'use strict';

const { Api503Error } = require('../../../core/error.response');
const {
    assertType,
    hashRequest,
    isMissingSatelliteCacheTable,
    requireSatelliteCache,
} = require('../cache');

describe('satellite cache module', () => {
    test('normalizes public endpoint aliases and rejects unknown types', () => {
        expect(assertType('heat-map')).toBe('heatmap');
        expect(() => assertType('thermal')).toThrow('Loại ảnh vệ tinh');
    });

    test('uses a stable cache hash independent of object key order', () => {
        expect(hashRequest({ a: 1, b: 2 })).toBe(hashRequest({ b: 2, a: 1 }));
    });

    test('turns a missing satellite cache table into a safe operational error', async () => {
        const error = Object.assign(
            new Error('relation "satellite.image_results" does not exist'),
            { code: '42P01' },
        );
        expect(isMissingSatelliteCacheTable(error)).toBe(true);
        await expect(requireSatelliteCache(() => Promise.reject(error))).rejects.toBeInstanceOf(
            Api503Error,
        );
    });
});
