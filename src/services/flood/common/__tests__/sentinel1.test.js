'use strict';

const s1 = require('../sentinel1');
const { ASSETS } = require('../datasets');

/**
 * Fake ee module that traces every top-level call and returns a chainable
 * proxy. Each `.method(arg)` call gets recorded on `calls`.
 */
const makeEe = () => {
    const calls = [];
    const record = (name) => (...args) => {
        calls.push({ name, args });
        return makeChain(name);
    };
    const makeChain = (parent) => {
        const chain = {};
        const methods = [
            'select', 'filter', 'map', 'filterBounds', 'filterDate',
            'updateMask', 'and', 'or', 'gte', 'lte', 'eq', 'not',
            'divide', 'pow', 'copyProperties', 'addBands', 'rename',
            'focal_median', 'set', 'cat', 'format', 'get', 'advance',
        ];
        for (const m of methods) {
            chain[m] = record(`${parent}.${m}`);
        }
        return chain;
    };
    const ee = {
        Image: record('Image'),
        ImageCollection: record('ImageCollection'),
        Kernel: { circle: record('Kernel.circle') },
        String: record('String'),
        Number: record('Number'),
        Date: record('Date'),
        Filter: {
            eq: record('Filter.eq'),
            listContains: record('Filter.listContains'),
            inList: record('Filter.inList'),
            and: record('Filter.and'),
            not: record('Filter.not'),
        },
        calls,
    };
    return ee;
};

describe('sentinel1.js locked constants', () => {
    test('speckle radius = 20 m (Flood_D:1636)', () => {
        expect(s1.SPECKLE_RADIUS_M).toBe(20);
    });
    test('incidence-angle window = 31°..45° (Flood_D:1600–1603)', () => {
        expect(s1.INCIDENCE_ANGLE_MIN_DEG).toBe(31);
        expect(s1.INCIDENCE_ANGLE_MAX_DEG).toBe(45);
    });
    test('VV window = -35..+5 dB, VH window = -40..0 dB', () => {
        expect(s1.VV_MIN_DB).toBe(-35);
        expect(s1.VV_MAX_DB).toBe(5);
        expect(s1.VH_MIN_DB).toBe(-40);
        expect(s1.VH_MAX_DB).toBe(0);
    });
    test('IW + VV+VH is baked in', () => {
        expect(s1.S1_COLLECTION_DEFAULTS.instrumentMode).toBe('IW');
        expect(s1.S1_COLLECTION_DEFAULTS.polarisations).toEqual(['VV', 'VH']);
    });
});

describe('sentinel1.js pure helpers', () => {
    test('toNatural requires an ee module and an image', () => {
        expect(() => s1.toNatural(null, {})).toThrow(/requires the ee module/);
        expect(() => s1.toNatural(makeEe(), null)).toThrow(/requires an image/);
    });

    test('maskS1Edges applies three updateMask calls (angle + VV + VH)', () => {
        const ee = makeEe();
        const image = {
            select: () => ({
                gte: () => ({ and: () => ({}), lte: () => ({}) }),
                lte: () => ({}),
                and: () => ({}),
            }),
            updateMask: jest.fn(function () { return this; }),
        };
        s1.maskS1Edges(ee, image);
        expect(image.updateMask).toHaveBeenCalledTimes(3);
    });

    test('addOrbitKey builds the "PASS_RELORBIT" property via ee.String/Number', () => {
        const ee = makeEe();
        const image = {
            get: jest.fn((prop) =>
                prop === 'orbitProperties_pass' ? 'ASCENDING' : 76,
            ),
            set: jest.fn(function () { return this; }),
        };
        s1.addOrbitKey(ee, image);
        // Called set('orbit_key', ...)
        expect(image.set).toHaveBeenCalled();
        const [prop] = image.set.mock.calls[0];
        expect(prop).toBe('orbit_key');
    });
});

describe('sentinel1.js getS1Collection', () => {
    const start = '2024-09-01';
    const end = '2024-09-30';
    const aoi = {};

    test('rejects missing required args', () => {
        const ee = makeEe();
        expect(() => s1.getS1Collection(ee, {})).toThrow(/start/);
        expect(() => s1.getS1Collection(ee, { start })).toThrow(/end/);
        expect(() => s1.getS1Collection(ee, { start, end })).toThrow(/aoi/);
    });

    test('applies filterBounds + filterDate + IW filter + polarisation filters', () => {
        const ee = makeEe();
        s1.getS1Collection(ee, { start, end, aoi });
        const names = ee.calls.map((c) => c.name);
        expect(names).toEqual(
            expect.arrayContaining([
                'ImageCollection',
                'ImageCollection.filterBounds',
                'ImageCollection.filterBounds.filterDate',
            ]),
        );
        const icArgs = ee.calls.find((c) => c.name === 'ImageCollection').args;
        expect(icArgs[0]).toBe(ASSETS.SENTINEL1_GRD);
    });

    test('AUTO orbit pass does NOT add an orbit filter', () => {
        const ee = makeEe();
        s1.getS1Collection(ee, { start, end, aoi, pass: 'AUTO' });
        const eqCalls = ee.calls.filter((c) => c.name === 'Filter.eq');
        // The IW mode filter and the VV/VH filters are separate — orbit_pass shouldn't be added
        expect(eqCalls.some((c) => c.args[0] === 'orbitProperties_pass')).toBe(false);
    });

    test('explicit orbit pass ADDS a Filter.eq(orbitProperties_pass, PASS)', () => {
        const ee = makeEe();
        s1.getS1Collection(ee, { start, end, aoi, pass: 'ASCENDING' });
        const eqCalls = ee.calls.filter((c) => c.name === 'Filter.eq');
        expect(eqCalls.some((c) => c.args[0] === 'orbitProperties_pass' && c.args[1] === 'ASCENDING'))
            .toBe(true);
    });

    test('numeric relativeOrbit adds a Filter.eq(relativeOrbitNumber_start, N)', () => {
        const ee = makeEe();
        s1.getS1Collection(ee, { start, end, aoi, relativeOrbit: 76 });
        const eqCalls = ee.calls.filter((c) => c.name === 'Filter.eq');
        expect(eqCalls.some((c) => c.args[0] === 'relativeOrbitNumber_start' && c.args[1] === 76))
            .toBe(true);
    });

    test('non-finite relativeOrbit is ignored', () => {
        const ee = makeEe();
        s1.getS1Collection(ee, { start, end, aoi, relativeOrbit: 'not-a-number' });
        const eqCalls = ee.calls.filter((c) => c.name === 'Filter.eq');
        expect(eqCalls.some((c) => c.args[0] === 'relativeOrbitNumber_start')).toBe(false);
    });
});
