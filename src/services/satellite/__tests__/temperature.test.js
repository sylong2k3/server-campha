'use strict';

const {
    LANDSAT_THERMAL_COLLECTIONS,
    NATIVE_THERMAL_RESOLUTION_METERS,
    OUTPUT_RESOLUTION_METERS,
    resolveThermalSources,
} = require('../builders/temperature');

describe('thermal Landsat configuration', () => {
    it.each([
        ['AUTO', ['L8', 'L9']],
        ['S2', ['L8', 'L9']],
        ['LANDSAT', ['L8', 'L9']],
        ['L8', ['L8']],
        ['L9', ['L9']],
    ])('uses thermal Landsat sources for %s', (collection, expected) => {
        expect(resolveThermalSources(collection)).toEqual(expected);
    });

    it('uses 30 m output grid while retaining the native thermal resolution', () => {
        expect(OUTPUT_RESOLUTION_METERS).toBe(30);
        expect(NATIVE_THERMAL_RESOLUTION_METERS).toBe(100);
        expect(LANDSAT_THERMAL_COLLECTIONS).toEqual({
            L8: 'LANDSAT/LC08/C02/T1_L2',
            L9: 'LANDSAT/LC09/C02/T1_L2',
        });
    });
});
