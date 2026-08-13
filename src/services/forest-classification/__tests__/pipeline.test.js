'use strict';

const { CLASS_DEFINITIONS, CLASSIFIED_VIZ } = require('../pipeline');

describe('Cam Pha forest-classification pipeline schema', () => {
    test('exposes a stable 12-class legend matching the visualization palette', () => {
        expect(CLASS_DEFINITIONS).toHaveLength(12);
        expect(CLASS_DEFINITIONS.map(({ value }) => value)).toEqual([
            0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11,
        ]);
        expect(CLASSIFIED_VIZ.palette).toEqual(CLASS_DEFINITIONS.map(({ color }) => color));
    });

    test('keeps the two forest classes explicit for downstream area summaries', () => {
        expect(CLASS_DEFINITIONS.filter(({ label }) => label.startsWith('Rừng'))).toEqual([
            expect.objectContaining({ value: 1, label: 'Rừng tự nhiên' }),
            expect.objectContaining({ value: 2, label: 'Rừng trồng' }),
        ]);
    });
});
