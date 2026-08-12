'use strict';

const mining = require('../mining-mask');
const reducers = require('../reducers');
const otsu = require('../otsu');
const { ASSETS } = require('../datasets');

const makeEe = () => {
    // Recursive proxy that lets deep GEE-style chains + `.map(cb)` calls run
    // without blowing up. Because a Proxy backed by `function () {}` is
    // itself typeof === 'function', we must NOT re-invoke proxies passed as
    // args (would recurse forever) — track them in a WeakSet.
    const calls = [];
    const proxies = new WeakSet();
    const makeProxy = (path) => {
        const p = new Proxy(function () {}, {
            get(_target, key) {
                if (key === 'then' || key === Symbol.toPrimitive) {
                    return undefined;
                }
                return makeProxy(`${path}.${String(key)}`);
            },
            apply(_target, _thisArg, args) {
                calls.push({ name: path, args });
                for (const arg of args) {
                    if (typeof arg === 'function' && !proxies.has(arg)) {
                        // Real user callback (e.g. list.map(i => ...)) — invoke it
                        // once with a proxy so any inner GEE calls execute.
                        arg(makeProxy(`${path}<cb>`));
                    }
                }
                return makeProxy(path);
            },
        });
        proxies.add(p);
        return p;
    };
    const ee = new Proxy(
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
    return ee;
};

describe('mining-mask.js', () => {
    test('MINING_HEURISTIC matches Flood_D:1963–1998 (slope>3, HAND>8, elev>80)', () => {
        expect(mining.MINING_HEURISTIC).toEqual({
            slopeGtDeg: 3,
            handGtM: 8,
            elevGtM: 80,
        });
    });

    test('createMiningMask heuristic-only path returns PROXY_WC_BARE', () => {
        const ee = makeEe();
        const { source, usedAsset } = mining.createMiningMask(ee, {
            slopeDeg: chainable(),
            handImage: chainable(),
            elevationImage: chainable(),
        });
        expect(source).toBe('PROXY_WC_BARE');
        expect(usedAsset).toBe(false);
    });

    test('createMiningMask with a supplied asset ID returns ASSET', () => {
        const ee = makeEe();
        const { source, usedAsset } = mining.createMiningMask(ee, {
            slopeDeg: chainable(),
            handImage: chainable(),
            elevationImage: chainable(),
            miningAssetId: 'projects/campha/mining_polygons',
        });
        expect(source).toBe('ASSET');
        expect(usedAsset).toBe(true);
        // WorldCover was still loaded for the heuristic OR
        const wcCall = ee.calls.find(
            (c) => c.name === 'ImageCollection' && c.args[0] === ASSETS.WORLDCOVER,
        );
        expect(wcCall).toBeTruthy();
    });

    test('createMiningMask rejects missing required inputs', () => {
        const ee = makeEe();
        expect(() => mining.createMiningMask(ee, {})).toThrow(/slopeDeg/);
    });
});

describe('reducers.js', () => {
    test('PIXEL_AREA_M2_PER_HA = 10 000', () => {
        expect(reducers.PIXEL_AREA_M2_PER_HA).toBe(10000);
    });

    test('areaHaSafe applies ee.Image.pixelArea() and Reducer.sum() to the mask', () => {
        const ee = makeEe();
        reducers.areaHaSafe(ee, { maskImage: chainable(), geometry: {} });
        expect(ee.calls.some((c) => c.name === 'Image.pixelArea')).toBe(true);
        // Reducer.sum + reduceRegion were touched
        expect(ee.calls.some((c) => c.name === 'Reducer.sum')).toBe(true);
        expect(ee.calls.some((c) => c.name.includes('reduceRegion'))).toBe(true);
    });

    test('areaHaSafe rejects missing mask/geometry', () => {
        const ee = makeEe();
        expect(() => reducers.areaHaSafe(ee, {})).toThrow(/maskImage/);
        expect(() => reducers.areaHaSafe(ee, { maskImage: {} })).toThrow(/geometry/);
    });

    test('percentiles rejects missing image/geometry', () => {
        const ee = makeEe();
        expect(() => reducers.percentiles(ee, {})).toThrow(/image/);
        expect(() => reducers.percentiles(ee, { image: {} })).toThrow(/geometry/);
    });

    test('areaHaByClass requires classifiedImage + maskImage + geometry', () => {
        const ee = makeEe();
        expect(() => reducers.areaHaByClass(ee, {})).toThrow(/classifiedImage/);
        expect(() => reducers.areaHaByClass(ee, { classifiedImage: {} })).toThrow(/maskImage/);
    });
});

describe('otsu.js', () => {
    test('IQR_TO_SIGMA equals 1 / 1.349', () => {
        expect(otsu.IQR_TO_SIGMA).toBeCloseTo(1 / 1.349);
    });

    test('otsuThresholdOnBand rejects non-numeric minDb / maxDb / fallback', () => {
        const ee = makeEe();
        expect(() =>
            otsu.otsuThresholdOnBand(ee, {
                image: {},
                band: 'VH',
                geometry: {},
                fallback: 2,
            }),
        ).toThrow(/numeric/);
    });

    test('otsuThresholdOnBand emits reduceRegion with the histogram reducer', () => {
        const ee = makeEe();
        otsu.otsuThresholdOnBand(ee, {
            image: chainable(),
            band: 'VH',
            geometry: {},
            minDb: 1.5,
            maxDb: 5.0,
            fallback: 2.0,
        });
        expect(ee.calls.some((c) => c.name === 'Reducer.histogram')).toBe(true);
    });

    test('computeMedianSigmaThreshold uses Reducer.percentile([25,50,75])', () => {
        const ee = makeEe();
        otsu.computeMedianSigmaThreshold(ee, {
            image: chainable(),
            band: 'VH',
            geometry: {},
            k: 3.5,
            minDb: 1.5,
            maxDb: 5.0,
            fallback: 2.0,
        });
        const pctCall = ee.calls.find((c) => c.name === 'Reducer.percentile');
        expect(pctCall.args[0]).toEqual([25, 50, 75]);
    });

    test('otsu requires ee + histogram', () => {
        expect(() => otsu.otsu(null, {})).toThrow(/requires the ee module/);
        expect(() => otsu.otsu(makeEe(), null)).toThrow(/requires a histogram/);
    });
});

// ── Local helpers ──────────────────────────────────────────────────────────
function chainable() {
    // Recursive proxy: every method returns another proxy so long call chains
    // don't throw. We only need to observe that the top-level call happened.
    const p = new Proxy(function () {}, {
        get() {
            return chainable();
        },
        apply() {
            return chainable();
        },
    });
    return p;
}
