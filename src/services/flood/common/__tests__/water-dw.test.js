'use strict';

const waterMasks = require('../water-masks');
const dw = require('../dynamic-world');
const { ASSETS } = require('../datasets');

const makeEe = () => {
    const calls = [];
    const record =
        (name) =>
        (...args) => {
            calls.push({ name, args });
            return chain(name);
        };
    const chain = (parent) => {
        const obj = {};
        for (const m of [
            'select',
            'gte',
            'lte',
            'gt',
            'and',
            'or',
            'not',
            'eq',
            'multiply',
            'add',
            'divide',
            'log',
            'tan',
            'max',
            'sin',
            'cos',
            'rename',
            'first',
            'mosaic',
            'mode',
            'filterBounds',
            'filterDate',
            'focal_mean',
            'focal_median',
        ]) {
            obj[m] = record(`${parent}.${m}`);
        }
        return obj;
    };
    const ee = {
        Image: record('Image'),
        ImageCollection: record('ImageCollection'),
        calls,
    };
    return ee;
};

describe('water-masks.js locked thresholds', () => {
    test('permanent water threshold = 90% occurrence / 8 months seasonality', () => {
        expect(waterMasks.PERMANENT_WATER_OCCURRENCE).toBe(90);
        expect(waterMasks.PERMANENT_WATER_SEASONALITY_MONTHS).toBe(8);
    });
    test('ephemeral water bracket = 5..75% occurrence (M5)', () => {
        expect(waterMasks.EPHEMERAL_WATER_OCC_MIN).toBe(5);
        expect(waterMasks.EPHEMERAL_WATER_OCC_MAX).toBe(75);
    });
    test('tidal-uncertainty elevation cap = 5 m', () => {
        expect(waterMasks.TIDAL_ELEVATION_MAX_M).toBe(5);
    });
    test('WC_CLASS covers the 4 tidal-candidate land-cover codes', () => {
        expect(waterMasks.WC_CLASS).toEqual({
            WATER: 80,
            HERBACEOUS_WETLAND: 90,
            MANGROVE: 95,
            BARE_SPARSE: 60,
        });
    });
});

describe('water-masks.js functions', () => {
    test('permanentWater loads JRC GSW and selects occurrence + seasonality', () => {
        const ee = makeEe();
        waterMasks.permanentWater(ee);
        const imageCall = ee.calls.find((c) => c.name === 'Image');
        expect(imageCall.args[0]).toBe(ASSETS.JRC_GSW);
        // Both bands were touched
        const selectCalls = ee.calls.filter((c) => c.name === 'Image.select');
        expect(selectCalls.map((c) => c.args[0])).toEqual(
            expect.arrayContaining(['occurrence', 'seasonality']),
        );
    });

    test('ephemeralWater uses the 5..75 bracket (not the permanent >= 90)', () => {
        const ee = makeEe();
        waterMasks.ephemeralWater(ee);
        const gt = ee.calls.find((c) => c.name === 'Image.select.gt');
        expect(gt.args[0]).toBe(5);
        // The `and` chain returns another chained proxy; we can at least verify
        // that ephemeral is bracketed (not one-sided).
        expect(ee.calls.some((c) => c.name.endsWith('.and'))).toBe(true);
    });

    test('tidalUncertainty requires an elevation image', () => {
        const ee = makeEe();
        expect(() => waterMasks.tidalUncertainty(ee, {})).toThrow(/elevation/);
    });

    test('buildWaterStack skips tidalUncertainty when no elevation image is supplied', () => {
        const ee = makeEe();
        const stack = waterMasks.buildWaterStack(ee);
        expect(stack.gsw).toBeDefined();
        expect(stack.permanent).toBeDefined();
        expect(stack.ephemeral).toBeDefined();
        expect(stack.tidalUncertainty).toBeNull();
    });

    test('buildWaterStack builds all four masks with an elevation image', () => {
        const ee = makeEe();
        const elevationImage = {
            lte: jest.fn(() => ({ and: () => ({ rename: () => ({}) }) })),
        };
        const stack = waterMasks.buildWaterStack(ee, { elevationImage });
        expect(stack.tidalUncertainty).toBeDefined();
        expect(elevationImage.lte).toHaveBeenCalledWith(waterMasks.TIDAL_ELEVATION_MAX_M);
    });
});

describe('dynamic-world.js', () => {
    test('DW_CLASS enum matches Google Dynamic World v1 codes', () => {
        expect(dw.DW_CLASS.WATER).toBe(0);
        expect(dw.DW_CLASS.BUILT).toBe(6);
        expect(dw.DW_CLASS.FLOODED_VEGETATION).toBe(3);
        expect(dw.DW_CLASS.BARE).toBe(7);
    });

    test('composite requires ee, startDate, endDate and aoi', () => {
        const ee = makeEe();
        expect(() => dw.composite(null, {})).toThrow(/requires the ee module/);
        expect(() => dw.composite(ee, {})).toThrow(/startDate/);
        expect(() => dw.composite(ee, { startDate: 'x' })).toThrow(/endDate/);
        expect(() => dw.composite(ee, { startDate: 'x', endDate: 'y' })).toThrow(/aoi/);
    });

    test('composite loads DYNAMIC_WORLD and applies mode()', () => {
        const ee = makeEe();
        dw.composite(ee, { startDate: '2024-01-01', endDate: '2024-12-31', aoi: {} });
        const icCall = ee.calls.find((c) => c.name === 'ImageCollection');
        expect(icCall.args[0]).toBe(ASSETS.DYNAMIC_WORLD);
        expect(ee.calls.some((c) => c.name.endsWith('.mode'))).toBe(true);
    });

    test('buildContext returns water/built/floodedVeg/bare + smoothed builtDensity', () => {
        const ee = makeEe();
        const ctx = dw.buildContext(ee, {
            startDate: '2023-01-01',
            endDate: '2023-12-31',
            aoi: {},
        });
        expect(ctx.label).toBeDefined();
        expect(ctx.water).toBeDefined();
        expect(ctx.built).toBeDefined();
        expect(ctx.floodedVeg).toBeDefined();
        expect(ctx.bare).toBeDefined();
        expect(ctx.builtDensity).toBeDefined();
        expect(ctx.cacheKey).toBe('2023-01-01|2023-12-31');
    });

    test('createRunCache memoises by (startDate,endDate)', () => {
        const ee = makeEe();
        const cache = dw.createRunCache();
        cache.get(ee, { startDate: '2024-01-01', endDate: '2024-12-31', aoi: {} });
        cache.get(ee, { startDate: '2024-01-01', endDate: '2024-12-31', aoi: {} });
        expect(cache.size()).toBe(1);
        cache.get(ee, { startDate: '2023-01-01', endDate: '2023-12-31', aoi: {} });
        expect(cache.size()).toBe(2);
        cache.clear();
        expect(cache.size()).toBe(0);
    });

    test('createRunCache instances are independent (no module-level state)', () => {
        const ee = makeEe();
        const a = dw.createRunCache();
        const b = dw.createRunCache();
        a.get(ee, { startDate: 'x', endDate: 'y', aoi: {} });
        expect(a.size()).toBe(1);
        expect(b.size()).toBe(0);
    });
});
