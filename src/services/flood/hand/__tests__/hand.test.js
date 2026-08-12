'use strict';

const { scenarioMask } = require('../scenario');
const { depthImage } = require('../depth');
const result = require('../result');
const { runHandScenario, defaultDeps } = require('../index');

// Chainable proxy — same pattern as flood/event tests.
const proxyMarks = new WeakSet();
const makeChainable = () => {
    const chain = () => {
        const p = new Proxy(function () {}, {
            get(_t, key) {
                if (key === 'then') {
                    return undefined;
                }
                // Jest's pretty-format calls String() / RegExp.test() on args
                // when printing failure diffs — return a sentinel so those
                // conversions don't throw "Cannot convert object to primitive".
                if (key === Symbol.toPrimitive) {
                    return () => '[eeProxy]';
                }
                if (key === 'toString') {
                    return () => '[eeProxy]';
                }
                return chain();
            },
            apply(_t, _thisArg, args) {
                for (const arg of args) {
                    if (typeof arg === 'function' && !proxyMarks.has(arg)) {
                        arg(chain());
                    }
                }
                return chain();
            },
        });
        proxyMarks.add(p);
        return p;
    };
    return chain();
};

const makeEe = () =>
    new Proxy(
        {},
        {
            get() {
                return makeChainable();
            },
        },
    );

describe('scenario.scenarioMask', () => {
    test('rejects missing ee / handImage', () => {
        expect(() => scenarioMask(null, {})).toThrow(/ee module/);
        expect(() => scenarioMask(makeEe(), {})).toThrow(/handImage/);
    });
    test('rejects non-positive levelM', () => {
        expect(() => scenarioMask(makeEe(), { handImage: makeChainable(), levelM: 0 })).toThrow(
            /levelM/,
        );
        expect(() => scenarioMask(makeEe(), { handImage: makeChainable(), levelM: -3 })).toThrow(
            /levelM/,
        );
    });
    test('runs to completion when slopeDeg is omitted', () => {
        expect(scenarioMask(makeEe(), { handImage: makeChainable(), levelM: 5 })).toBeDefined();
    });
    test('runs to completion when slopeDeg is supplied', () => {
        expect(
            scenarioMask(makeEe(), {
                handImage: makeChainable(),
                levelM: 5,
                slopeDeg: makeChainable(),
                maximumSlope: 12,
            }),
        ).toBeDefined();
    });
});

describe('depth.depthImage', () => {
    test('rejects missing inputs', () => {
        const ee = makeEe();
        expect(() => depthImage(ee, {})).toThrow(/handImage/);
        expect(() => depthImage(ee, { handImage: makeChainable() })).toThrow(/scenarioMask/);
        expect(() =>
            depthImage(ee, { handImage: makeChainable(), scenarioMask: makeChainable() }),
        ).toThrow(/levelM/);
    });
    test('runs with valid inputs', () => {
        expect(
            depthImage(makeEe(), {
                handImage: makeChainable(),
                scenarioMask: makeChainable(),
                levelM: 5,
            }),
        ).toBeDefined();
    });
});

describe('result.js', () => {
    test('M2_ARTIFACTS = [hand_scenario, hand_depth] as PRODUCT roles', () => {
        expect(result.M2_ARTIFACTS.map((a) => a.code)).toEqual(['hand_scenario', 'hand_depth']);
        for (const a of result.M2_ARTIFACTS) {
            expect(a.role).toBe('PRODUCT');
        }
    });
    test('CODE_TO_ARTIFACT lookup includes both codes', () => {
        expect(result.CODE_TO_ARTIFACT.hand_scenario).toBeDefined();
        expect(result.CODE_TO_ARTIFACT.hand_depth).toBeDefined();
    });
    test('label uses "Kịch bản HAND" wording (§16 terminology rule)', () => {
        expect(result.CODE_TO_ARTIFACT.hand_scenario.label.vi).toBe('Kịch bản HAND');
    });
    test('selectM2Artifacts returns both entries regardless of mode', () => {
        expect(result.selectM2Artifacts({ runMode: 'product' })).toHaveLength(2);
        expect(result.selectM2Artifacts({ runMode: 'calibration' })).toHaveLength(2);
    });
    test('buildM2ResultMetadata returns fully-nulled shape on empty input', () => {
        expect(result.buildM2ResultMetadata({})).toEqual({
            levelM: null,
            maximumSlope: null,
            scenarioAreaHa: null,
            meanDepthM: null,
            maxDepthM: null,
            warnings: [],
        });
    });
    test('buildM2ResultMetadata preserves valid scalars', () => {
        const md = result.buildM2ResultMetadata({
            levelM: 5,
            maximumSlope: 12,
            scenarioAreaHa: 314.15,
            meanDepthM: 2.1,
            maxDepthM: 4.6,
            warnings: ['NON_COMMERCIAL_DTM_FABDEM'],
        });
        expect(md.levelM).toBe(5);
        expect(md.scenarioAreaHa).toBeCloseTo(314.15);
        expect(md.warnings).toEqual(['NON_COMMERCIAL_DTM_FABDEM']);
    });
});

// ── Orchestrator tests (DI-only, no real ee) ─────────────────────────────

const chain = () => makeChainable();
const makeStubs = (overrides = {}) => ({
    geometry: {
        loadAoi: jest.fn(() => ({ fc: chain(), geometry: chain(), source: 'REFERENCE_GAUL' })),
    },
    terrain: {
        buildTerrainStack: jest.fn(() => ({
            elevation: chain(),
            slope: chain(),
            source: 'FABDEM',
            isFallback: false,
            nonCommercial: true,
        })),
    },
    hand: {
        buildHandStack: jest.fn(() => ({
            hand: chain(),
            upa: chain(),
            twi: chain(),
            flowDirection: chain(),
        })),
    },
    reducers: {
        areaHaSafe: jest.fn(() => chain()),
        percentiles: jest.fn(() => chain()),
    },
    morphology: {
        removeSmallFloodObjects: jest.fn(() => chain()),
    },
    scenario: { scenarioMask: jest.fn(() => chain()) },
    depth: { depthImage: jest.fn(() => chain()) },
    result: {
        selectM2Artifacts: jest.fn(() => [
            { code: 'hand_scenario', role: 'PRODUCT', label: {}, description: '', style: '' },
        ]),
        buildM2ResultMetadata: jest.fn((md) => ({
            levelM: md.levelM ?? null,
            maximumSlope: md.maximumSlope ?? null,
            scenarioAreaHa: md.scenarioAreaHa ?? null,
            meanDepthM: md.meanDepthM ?? null,
            maxDepthM: md.maxDepthM ?? null,
            warnings: md.warnings || [],
        })),
    },
    ...overrides,
});

const geeAdapter = (evaluateResolves = 100) => ({
    evaluate: jest.fn().mockResolvedValue(evaluateResolves),
});

describe('runHandScenario — orchestrator', () => {
    test('rejects missing ee / geeAdapter / runConfig', async () => {
        await expect(runHandScenario({})).rejects.toThrow(/ee module/);
        await expect(runHandScenario({ ee: makeEe() })).rejects.toThrow(/geeAdapter/);
        await expect(
            runHandScenario({ ee: makeEe(), geeAdapter: { evaluate: async () => {} } }),
        ).rejects.toThrow(/runConfig/);
    });

    test('rejects invalid runMode', async () => {
        await expect(
            runHandScenario({
                ee: makeEe(),
                geeAdapter: geeAdapter(),
                runConfig: { levelM: 5 },
                runMode: 'debug',
                deps: makeStubs(),
            }),
        ).rejects.toThrow(/Unsupported flood run mode/);
    });

    test('happy path with default level=5m returns hand_scenario + hand_depth artifacts', async () => {
        const stubs = makeStubs();
        const out = await runHandScenario({
            ee: makeEe(),
            geeAdapter: geeAdapter(),
            runConfig: {}, // uses HAND_DEFAULTS
            deps: stubs,
        });
        expect(out.artifacts.hand_scenario).toBeDefined();
        expect(out.artifacts.hand_depth).toBeDefined();
        expect(out.metadata.pipelineVersion).toBe('HAND_V1');
        expect(out.metadata.configVersion).toBe('V1');
        expect(out.metadata.aoiSource).toBe('REFERENCE_GAUL');
        expect(out.metadata.warnings).toContain('NON_COMMERCIAL_DTM_FABDEM');
    });

    test('caller can override levelM', async () => {
        const stubs = makeStubs();
        await runHandScenario({
            ee: makeEe(),
            geeAdapter: geeAdapter(),
            runConfig: { levelM: 3 },
            deps: stubs,
        });
        // Check mock.calls directly to avoid Jest's Proxy-unfriendly asymmetric
        // matchers. scenarioMask is called with (ee, argsObject).
        const scenarioArgs = stubs.scenario.scenarioMask.mock.calls[0][1];
        expect(scenarioArgs.levelM).toBe(3);
        const metadataArgs = stubs.result.buildM2ResultMetadata.mock.calls[0][0];
        expect(metadataArgs.levelM).toBe(3);
    });

    test('DSM fallback stamps TERRAIN_FELL_BACK_TO_DSM in warnings', async () => {
        const stubs = makeStubs();
        stubs.terrain.buildTerrainStack.mockReturnValueOnce({
            elevation: chain(),
            slope: chain(),
            source: 'COPERNICUS_DSM',
            isFallback: true,
            nonCommercial: false,
        });
        const out = await runHandScenario({
            ee: makeEe(),
            geeAdapter: geeAdapter(),
            runConfig: { levelM: 5 },
            deps: stubs,
        });
        expect(out.metadata.warnings).toContain('TERRAIN_FELL_BACK_TO_DSM');
        expect(out.metadata.warnings).not.toContain('NON_COMMERCIAL_DTM_FABDEM');
    });
});

describe('defaultDeps', () => {
    test('exposes every M2 helper module', () => {
        const d = defaultDeps();
        for (const key of [
            'geometry',
            'terrain',
            'hand',
            'reducers',
            'morphology',
            'scenario',
            'depth',
            'result',
        ]) {
            expect(d[key]).toBeDefined();
        }
    });
});
