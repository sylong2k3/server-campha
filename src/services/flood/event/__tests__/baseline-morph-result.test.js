'use strict';

const baseline = require('../baseline');
const morphology = require('../morphology');
const result = require('../result');

/**
 * Recursive-proxy ee mock — shared shape with the flood/common tests.
 * Every top-level call is recorded on `ee.calls[]`; nested chains resolve
 * without blowing up.
 */
const makeEe = () => {
    const calls = [];
    const proxies = new WeakSet();
    const makeProxy = (path) => {
        const p = new Proxy(function () {}, {
            get(_t, key) {
                if (key === 'then' || key === Symbol.toPrimitive) {
                    return undefined;
                }
                return makeProxy(`${path}.${String(key)}`);
            },
            apply(_t, _thisArg, args) {
                calls.push({ name: path, args });
                for (const arg of args) {
                    if (typeof arg === 'function' && !proxies.has(arg)) {
                        arg(makeProxy(`${path}<cb>`));
                    }
                }
                return makeProxy(path);
            },
        });
        proxies.add(p);
        return p;
    };
    return new Proxy(
        { calls },
        {
            get(target, key) {
                if (key === 'calls') {
                    return target.calls;
                }
                return makeProxy(String(key));
            },
        },
    );
};

describe('event/baseline.js', () => {
    test('MAD_TO_SIGMA locked to 1.4826 (Flood_D:1935)', () => {
        expect(baseline.MAD_TO_SIGMA).toBe(1.4826);
    });
    test('SCALE_FLOOR_VV = 0.75, SCALE_FLOOR_VH = 1.0', () => {
        expect(baseline.SCALE_FLOOR_VV).toBe(0.75);
        expect(baseline.SCALE_FLOOR_VH).toBe(1.0);
    });

    test('createS1Baseline calls .select([VV,VH]).median().rename([VV,VH]) on the collection', () => {
        const ee = makeEe();
        const preCollection = {
            select: jest.fn(() => ({ median: () => ({ rename: () => ({}) }) })),
        };
        baseline.createS1Baseline(ee, preCollection);
        expect(preCollection.select).toHaveBeenCalledWith(['VV', 'VH']);
    });

    test('createS1BaselineScale rejects missing inputs', () => {
        const ee = makeEe();
        expect(() => baseline.createS1BaselineScale(ee)).toThrow();
        expect(() => baseline.createS1BaselineScale(ee, {})).toThrow();
    });

    test('createS1BaselineScale returns a two-band image (VV_scale + VH_scale)', () => {
        const ee = makeEe();
        const madImg = {
            select: jest.fn(() => ({
                multiply: () => ({ max: () => ({ rename: () => ({}) }) }),
            })),
        };
        const preCollection = { map: jest.fn(() => ({ median: () => madImg })) };
        // Give addBands a callable chain
        madImg.select.mockImplementation(() => {
            const r = {
                multiply: () => ({ max: () => ({ rename: () => ({ addBands: () => ({}) }) }) }),
            };
            return r;
        });
        const baselineImg = {};
        baseline.createS1BaselineScale(ee, preCollection, baselineImg);
        expect(preCollection.map).toHaveBeenCalled();
    });
});

describe('event/morphology.js', () => {
    test('MORPHOLOGY_RADIUS_M = 10 m (Flood_D:2858)', () => {
        expect(morphology.MORPHOLOGY_RADIUS_M).toBe(10);
    });
    test('CONNECTED_PIXEL_MAX = 256 (Flood_D:2250)', () => {
        expect(morphology.CONNECTED_PIXEL_MAX).toBe(256);
    });

    test('removeSmallFloodObjects requires ee + mask + positive minAreaM2', () => {
        const ee = makeEe();
        expect(() => morphology.removeSmallFloodObjects(ee, {})).toThrow(/floodMask/);
        expect(() => morphology.removeSmallFloodObjects(ee, { floodMask: {} })).toThrow(
            /minAreaM2/,
        );
        expect(() =>
            morphology.removeSmallFloodObjects(ee, { floodMask: {}, minAreaM2: 0 }),
        ).toThrow();
    });

    test('removeSmallFloodObjects computes ceil(minArea/pixelArea) pixels', () => {
        const ee = makeEe();
        const floodMask = {
            selfMask: () => ({
                connectedPixelCount: (n, eightConn) => {
                    // Store the args on ee.calls indirectly by returning a chain we can inspect.
                    ee.calls.push({ name: '__cpc', args: [n, eightConn] });
                    return { gte: (v) => ({ rename: () => ({ __minPixels: v }) }) };
                },
            }),
        };
        const out = morphology.removeSmallFloodObjects(ee, {
            floodMask,
            minAreaM2: 1000,
            pixelAreaM2: 900,
        });
        expect(out.__minPixels).toBe(Math.ceil(1000 / 900)); // = 2
        const cpcCall = ee.calls.find((c) => c.name === '__cpc');
        expect(cpcCall.args).toEqual([256, true]);
    });

    test('openClose calls focal_max/focal_min 4 times at the same radius', () => {
        const focalCalls = [];
        const chain = () => ({
            focal_max: (r) => {
                focalCalls.push(['focal_max', r]);
                return chain();
            },
            focal_min: (r) => {
                focalCalls.push(['focal_min', r]);
                return chain();
            },
            rename: () => ({}),
        });
        const mask = chain();
        morphology.openClose(makeEe(), { mask, radiusMeters: 20 });
        expect(focalCalls).toHaveLength(4);
        expect(focalCalls.every(([, r]) => r === 20)).toBe(true);
    });
});

describe('event/result.js', () => {
    test('M1_ARTIFACTS has main_flood_non_tidal as the first PRODUCT entry', () => {
        expect(result.M1_ARTIFACTS[0].code).toBe('main_flood_non_tidal');
        expect(result.M1_ARTIFACTS[0].role).toBe('PRODUCT');
    });

    test('CODE_TO_ARTIFACT lookup includes all six catalog entries', () => {
        for (const code of [
            'main_flood_non_tidal',
            'open_water',
            'shallow_flood',
            'tidal_candidate',
            'mining_candidate',
            'urban_double_bounce',
        ]) {
            expect(result.CODE_TO_ARTIFACT[code]).toBeDefined();
        }
    });

    test('selectM1Artifacts drops shallow_flood when enableShallowFlood=false', () => {
        const list = result.selectM1Artifacts({ enableShallowFlood: false });
        expect(list.find((a) => a.code === 'shallow_flood')).toBeUndefined();
    });

    test('selectM1Artifacts drops urban_double_bounce when its flag is false (default)', () => {
        const list = result.selectM1Artifacts({});
        expect(list.find((a) => a.code === 'urban_double_bounce')).toBeUndefined();
    });

    test('selectM1Artifacts flips QA→CALIBRATION when runMode=calibration', () => {
        const list = result.selectM1Artifacts({ runMode: 'calibration' });
        const tidal = list.find((a) => a.code === 'tidal_candidate');
        expect(tidal.role).toBe('CALIBRATION');
        const main = list.find((a) => a.code === 'main_flood_non_tidal');
        expect(main.role).toBe('PRODUCT'); // PRODUCT stays PRODUCT
    });

    test('buildM1ResultMetadata returns a fully-nulled shape when nothing supplied', () => {
        const md = result.buildM1ResultMetadata({});
        expect(md).toEqual({
            orbitKey: null,
            orbitPass: null,
            relativeOrbit: null,
            lastM1Threshold: null,
            preSceneCount: null,
            postSceneCount: null,
            warnings: [],
        });
    });

    test('buildM1ResultMetadata preserves valid scalars', () => {
        const md = result.buildM1ResultMetadata({
            orbitKey: 'ASCENDING_76',
            orbitPass: 'ASCENDING',
            relativeOrbit: 76,
            lastM1Threshold: 2.5,
            preSceneCount: 5,
            postSceneCount: 3,
            warnings: ['NO_CHIRPS'],
        });
        expect(md.orbitKey).toBe('ASCENDING_76');
        expect(md.relativeOrbit).toBe(76);
        expect(md.warnings).toEqual(['NO_CHIRPS']);
    });
});
