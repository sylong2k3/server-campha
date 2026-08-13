'use strict';

const {
    MODIS_LST_ID,
    MODIS_RESOLUTION_METERS,
} = require('../builders/temperature');

describe('MODIS thermal configuration', () => {
    it('uses the stable daily MODIS LST product at its native 1 km scale', () => {
        expect(MODIS_LST_ID).toBe('MODIS/061/MOD11A1');
        expect(MODIS_RESOLUTION_METERS).toBe(1000);
    });
});
