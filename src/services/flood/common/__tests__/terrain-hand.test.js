'use strict';

const terrain = require('../terrain');
const hand = require('../hand');
const { ASSETS } = require('../datasets');

/**
 * Bare-bones ee spy that records every top-level call and lets any chained
 * method return a chainable proxy. Sufficient for verifying which asset the
 * code touches and which .select/.multiply chain it applies.
 */
const makeEe = () => {
    const calls = [];
    const record = (name) => (...args) => {
        calls.push({ name, args });
        return makeChain(name);
    };
    const makeChain = (parent) => {
        const chain = {};
        for (const m of [
            'select', 'mosaic', 'rename', 'add', 'log', 'divide',
            'multiply', 'tan', 'max', 'sin', 'cos', 'first',
        ]) {
            chain[m] = record(`${parent}.${m}`);
        }
        return chain;
    };
    const ee = {
        Image: record('Image'),
        ImageCollection: record('ImageCollection'),
        Terrain: {
            slope: record('Terrain.slope'),
            aspect: record('Terrain.aspect'),
        },
        calls,
    };
    return ee;
};

describe('terrain.js', () => {
    test('TERRAIN_SOURCE enum has exactly two values', () => {
        expect(terrain.TERRAIN_SOURCE).toEqual({
            FABDEM: 'FABDEM',
            COPERNICUS_DSM: 'COPERNICUS_DSM',
        });
    });

    test('loadDtm defaults to FABDEM with the non-commercial flag set', () => {
        const ee = makeEe();
        const dtm = terrain.loadDtm(ee);
        expect(dtm.source).toBe('FABDEM');
        expect(dtm.isFallback).toBe(false);
        expect(dtm.nonCommercial).toBe(true);
        // Loaded from the FABDEM asset ID
        const icCall = ee.calls.find((c) => c.name === 'ImageCollection');
        expect(icCall.args[0]).toBe(ASSETS.FABDEM);
    });

    test('useFallback=true switches to COPERNICUS_DSM (non-commercial=false)', () => {
        const ee = makeEe();
        const dtm = terrain.loadDtm(ee, { useFallback: true });
        expect(dtm.source).toBe('COPERNICUS_DSM');
        expect(dtm.isFallback).toBe(true);
        expect(dtm.nonCommercial).toBe(false);
        const icCall = ee.calls.find((c) => c.name === 'ImageCollection');
        expect(icCall.args[0]).toBe(ASSETS.COPERNICUS_DEM_GLO30);
    });

    test('slopeDegrees calls ee.Terrain.slope with the DTM image', () => {
        const ee = makeEe();
        const dtmImage = { __label: 'fabdem-image' };
        terrain.slopeDegrees(ee, dtmImage);
        const slopeCall = ee.calls.find((c) => c.name === 'Terrain.slope');
        expect(slopeCall.args[0]).toBe(dtmImage);
    });

    test('aspectComponents returns sin+cos-renamed images', () => {
        const ee = makeEe();
        const stack = terrain.aspectComponents(ee, { __label: 'dtm' });
        expect(stack.aspect).toBeDefined();
        expect(stack.aspectSin).toBeDefined();
        expect(stack.aspectCos).toBeDefined();
        // sin/cos were derived after Terrain.aspect
        expect(ee.calls.some((c) => c.name === 'Terrain.aspect')).toBe(true);
    });

    test('buildTerrainStack yields elevation + slope + aspect(+sin+cos) with source metadata', () => {
        const ee = makeEe();
        const stack = terrain.buildTerrainStack(ee);
        expect(stack.source).toBe('FABDEM');
        expect(stack.elevation).toBeDefined();
        expect(stack.slope).toBeDefined();
        expect(stack.aspect).toBeDefined();
        expect(stack.aspectSin).toBeDefined();
        expect(stack.aspectCos).toBeDefined();
        expect(stack.nonCommercial).toBe(true);
    });
});

describe('hand.js', () => {
    test('loadMeritHydro instantiates the MERIT/Hydro image', () => {
        const ee = makeEe();
        hand.loadMeritHydro(ee);
        const imgCall = ee.calls.find((c) => c.name === 'Image');
        expect(imgCall.args[0]).toBe(ASSETS.MERIT_HYDRO);
    });

    test('handImage selects and renames the "hnd" band', () => {
        const ee = makeEe();
        hand.handImage(ee);
        // ee.Image(MERIT).select('hnd').rename('HAND')
        expect(ee.calls.some((c) => c.name === 'Image.select' && c.args[0] === 'hnd')).toBe(true);
        expect(ee.calls.some((c) => c.name === 'Image.select.rename' && c.args[0] === 'HAND')).toBe(true);
    });

    test('upaImage selects and renames the "upa" band', () => {
        const ee = makeEe();
        hand.upaImage(ee);
        expect(ee.calls.some((c) => c.name === 'Image.select' && c.args[0] === 'upa')).toBe(true);
    });

    test('twiImage requires an ee module and a slope image', () => {
        expect(() => hand.twiImage(null, {})).toThrow(/requires the ee module/);
        const ee = makeEe();
        expect(() => hand.twiImage(ee, null)).toThrow(/requires the slope image/);
    });

    test('twiImage applies tan(slope in radians).max(0.001) guard', () => {
        const ee = makeEe();
        const slopeDeg = {
            multiply: jest.fn(function () { return this; }),
            tan: jest.fn(function () { return this; }),
            max: jest.fn(function () { return this; }),
        };
        hand.twiImage(ee, slopeDeg);
        expect(slopeDeg.multiply).toHaveBeenCalledWith(Math.PI / 180);
        expect(slopeDeg.tan).toHaveBeenCalled();
        expect(slopeDeg.max).toHaveBeenCalledWith(hand.TAN_SLOPE_FLOOR);
    });

    test('buildHandStack returns hand + upa + twi + flowDirection', () => {
        const ee = makeEe();
        const slopeDeg = {
            multiply: jest.fn(function () { return this; }),
            tan: jest.fn(function () { return this; }),
            max: jest.fn(function () { return this; }),
        };
        const stack = hand.buildHandStack(ee, slopeDeg);
        expect(stack.hand).toBeDefined();
        expect(stack.upa).toBeDefined();
        expect(stack.twi).toBeDefined();
        expect(stack.flowDirection).toBeDefined();
    });

    test('locked constants match Flood_D:730 / 734', () => {
        expect(hand.TAN_SLOPE_FLOOR).toBe(0.001);
        expect(hand.UPA_LOG_EPSILON).toBe(0.001);
    });
});
