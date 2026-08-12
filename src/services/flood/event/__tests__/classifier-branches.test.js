'use strict';

const { shallowFloodVote } = require('../shallow-flood');
const { urbanDoubleBounceVote } = require('../urban-double-bounce');
const { splitByTidal, TIDAL_CONFIDENCE_FACTOR } = require('../tidal-split');
const {
    darkFloodSupportScore,
    classifySinglePostImage,
    reduceVotesToMask,
    applyEventModeOverride,
} = require('../classifier');

// Recursive-proxy ee mock (same as earlier batches). We only care that
// arithmetic + boolean chains complete without throwing and record the
// top-level calls we care about.
const makeEe = () => {
    const calls = [];
    const proxies = new WeakSet();
    const makeProxy = (path) => {
        const p = new Proxy(function () {}, {
            get(_t, key) {
                if (key === 'then' || key === Symbol.toPrimitive) {return undefined;}
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
                if (key === 'calls') {return target.calls;}
                return makeProxy(String(key));
            },
        },
    );
};

// Chainable image factory — for assertions that don't need proxy shape.
const image = () => {
    const chain = () => new Proxy(function () {}, {
        get() { return chain(); },
        apply() { return chain(); },
    });
    return chain();
};

describe('shallow-flood.shallowFloodVote', () => {
    test('rejects missing inputs', () => {
        expect(() => shallowFloodVote(null, {})).toThrow(/requires the ee module/);
        const ee = makeEe();
        expect(() => shallowFloodVote(ee, {})).toThrow(/postVH/);
        expect(() => shallowFloodVote(ee, { postVH: image() })).toThrow(/vhDecrease/);
    });

    test('rejects non-numeric threshold args', () => {
        const ee = makeEe();
        expect(() =>
            shallowFloodVote(ee, {
                postVH: image(),
                vhDecrease: image(),
                vhDecreaseDb: '2',
                shallowExtraDb: 0.4,
                shallowPostVHDb: -15.5,
                postVHDbDarkFloor: -18,
            }),
        ).toThrow(/numeric/);
    });

    test('produces a chainable ee.Image when supplied with all numeric knobs', () => {
        const ee = makeEe();
        const out = shallowFloodVote(ee, {
            postVH: image(),
            vhDecrease: image(),
            vhDecreaseDb: 2.0,
            shallowExtraDb: 0.4,
            shallowPostVHDb: -15.5,
            postVHDbDarkFloor: -18,
        });
        expect(out).toBeDefined();
    });
});

describe('urban-double-bounce.urbanDoubleBounceVote', () => {
    const validArgs = () => ({
        vvIncrease: image(),
        vvZ: image(),
        vhDecrease: image(),
        builtDensity: image(),
        slopeDeg: image(),
        handImage: image(),
        thresholds: {
            urbanVVIncreaseDb: 1.5,
            urbanVVZ: 2.0,
            urbanVHDecreaseToleranceDb: 1.0,
            urbanBuiltDensity: 0.5,
            urbanMaximumSlope: 10,
            urbanMaximumHAND: 15,
        },
    });

    test('rejects missing image inputs', () => {
        const ee = makeEe();
        expect(() => urbanDoubleBounceVote(ee, {})).toThrow(/requires/);
    });

    test('rejects incomplete threshold set', () => {
        const ee = makeEe();
        const args = validArgs();
        delete args.thresholds.urbanBuiltDensity;
        expect(() => urbanDoubleBounceVote(ee, args)).toThrow(/urbanBuiltDensity/);
    });

    test('runs to completion with the reference thresholds', () => {
        const ee = makeEe();
        const out = urbanDoubleBounceVote(ee, validArgs());
        expect(out).toBeDefined();
    });
});

describe('tidal-split.splitByTidal', () => {
    test('returns both floodNonTidal + tidalFloodCandidate images', () => {
        const ee = makeEe();
        const out = splitByTidal(ee, {
            floodMask: image(),
            tidalUncertainty: image(),
        });
        expect(out.floodNonTidal).toBeDefined();
        expect(out.tidalFloodCandidate).toBeDefined();
    });

    test('rejects missing inputs', () => {
        const ee = makeEe();
        expect(() => splitByTidal(ee, {})).toThrow(/floodMask/);
        expect(() => splitByTidal(ee, { floodMask: image() })).toThrow(/tidalUncertainty/);
    });

    test('TIDAL_CONFIDENCE_FACTOR = 0.5 (Flood_D:2796–2801)', () => {
        expect(TIDAL_CONFIDENCE_FACTOR).toBe(0.5);
    });
});

describe('classifier.darkFloodSupportScore', () => {
    test('rejects missing inputs', () => {
        const ee = makeEe();
        expect(() => darkFloodSupportScore(ee, {})).toThrow();
    });

    test('produces a chainable image from three votes', () => {
        const ee = makeEe();
        const out = darkFloodSupportScore(ee, {
            preVV: image(),
            postVV: image(),
            postVH: image(),
            thresholds: {
            vhDecreaseDb: 2.0,
            vvDecreaseDb: 0.8,
            postVHDb: -18,
            postVVDb: -11,
        },
        });
        expect(out).toBeDefined();
    });
});

describe('classifier.classifySinglePostImage', () => {
    const validArgs = () => ({
        preBaselineVV: image(),
        preBaselineVH: image(),
        postVV: image(),
        postVH: image(),
        vhScale: image(),
        vvScale: image(),
        decisionThreshold: 2.0,
        thresholds: {
            vhDecreaseDb: 2.0,
            vvDecreaseDb: 0.8,
            postVHDb: -18,
            postVVDb: -11,
        },
        minimumDarkSupportVotes: 3,
    });

    test('rejects when minimumDarkSupportVotes is not numeric', () => {
        const ee = makeEe();
        const args = validArgs();
        args.minimumDarkSupportVotes = 'three';
        expect(() => classifySinglePostImage(ee, args)).toThrow(/numeric minimumDarkSupportVotes/);
    });

    test('runs with dark branch only (no shallow, no urban)', () => {
        const ee = makeEe();
        expect(classifySinglePostImage(ee, validArgs())).toBeDefined();
    });

    test('runs with shallow branch enabled', () => {
        const ee = makeEe();
        const args = validArgs();
        args.shallowContext = {
            enableShallowFlood: true,
            shallowExtraDb: 0.4,
            shallowPostVHDb: -15.5,
        };
        expect(classifySinglePostImage(ee, args)).toBeDefined();
    });

    test('runs with urban branch enabled', () => {
        const ee = makeEe();
        const args = validArgs();
        args.urbanContext = {
            enableUrban: true,
            builtDensity: image(),
            slopeDeg: image(),
            handImage: image(),
            thresholds: {
                urbanVVIncreaseDb: 1.5,
                urbanVVZ: 2.0,
                urbanVHDecreaseToleranceDb: 1.0,
                urbanBuiltDensity: 0.5,
                urbanMaximumSlope: 10,
                urbanMaximumHAND: 15,
            },
        };
        expect(classifySinglePostImage(ee, args)).toBeDefined();
    });
});

describe('classifier.reduceVotesToMask', () => {
    test('rejects non-numeric threshold args', () => {
        const ee = makeEe();
        expect(() =>
            reduceVotesToMask(ee, {
                voteCollection: image(),
                minimumVotes: 'x',
                minimumObservations: 1,
                minimumVoteFraction: 0.5,
            }),
        ).toThrow(/numeric/);
    });

    test('runs with valid numeric thresholds', () => {
        const ee = makeEe();
        const out = reduceVotesToMask(ee, {
            voteCollection: image(),
            minimumVotes: 2,
            minimumObservations: 2,
            minimumVoteFraction: 0.6,
        });
        expect(out).toBeDefined();
    });
});

describe('classifier.applyEventModeOverride', () => {
    test('eventMode=true collapses votes/obs to 1 and fraction to 0', () => {
        expect(
            applyEventModeOverride({
                eventMode: true,
                minimumVotes: 5,
                minimumObservations: 5,
                minimumVoteFraction: 0.8,
            }),
        ).toEqual({ minimumVotes: 1, minimumObservations: 1, minimumVoteFraction: 0 });
    });

    test('eventMode=false leaves the thresholds untouched', () => {
        const input = {
            eventMode: false,
            minimumVotes: 2,
            minimumObservations: 2,
            minimumVoteFraction: 0.6,
        };
        const out = applyEventModeOverride(input);
        expect(out).toEqual({
            minimumVotes: 2,
            minimumObservations: 2,
            minimumVoteFraction: 0.6,
        });
    });
});
