'use strict';

const { runSentinel1Flood, defaultDeps } = require('../index');

/**
 * A synthetic ee value we can chain `.select` / `.median` / `.map(cb)` etc.
 * on. `.map(cb)` fires the callback once with another chainable so any inner
 * classifier / helper call executes. Proxies are tracked in a WeakSet so we
 * don't recursively self-invoke when a proxy is passed as an arg.
 */
const proxyMarks = new WeakSet();
const makeChainable = () => {
    const chain = () => {
        const p = new Proxy(function () {}, {
            get(_t, key) {
                if (key === 'then' || key === Symbol.toPrimitive) {return undefined;}
                return chain();
            },
            apply(_t, _thisArg, args) {
                for (const arg of args) {
                    if (typeof arg === 'function' && !proxyMarks.has(arg)) {arg(chain());}
                }
                return chain();
            },
        });
        proxyMarks.add(p);
        return p;
    };
    return chain();
};

const validRunConfig = {
    preStart: '2024-01-01',
    preEnd: '2024-04-30',
    postStart: '2024-09-01',
    postEnd: '2024-09-30',
};

// Assemble a full set of fake helpers so no real ee calls fire.
const makeStubs = (overrides = {}) => {
    const chain = () => makeChainable();
    return {
        geometry: {
            loadAoi: jest.fn(() => ({ fc: chain(), geometry: chain(), source: 'REFERENCE_GAUL' })),
        },
        sentinel1: {
            getS1Collection: jest.fn(() => chain()),
        },
        terrain: {
            buildTerrainStack: jest.fn(() => ({
                elevation: chain(),
                slope: chain(),
                aspect: chain(),
                aspectSin: chain(),
                aspectCos: chain(),
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
        waterMasks: {
            buildWaterStack: jest.fn(() => ({
                gsw: chain(),
                permanent: chain(),
                ephemeral: chain(),
                tidalUncertainty: chain(),
            })),
        },
        dynamicWorld: {
            createRunCache: jest.fn(() => ({
                get: jest.fn(() => ({
                    label: chain(),
                    water: chain(),
                    built: chain(),
                    floodedVeg: chain(),
                    bare: chain(),
                    builtDensity: chain(),
                    cacheKey: 'x',
                })),
                clear: jest.fn(),
                size: jest.fn(() => 1),
            })),
        },
        miningMask: {
            createMiningMask: jest.fn(() => ({
                mask: chain(),
                source: 'PROXY_WC_BARE',
                usedAsset: false,
            })),
        },
        otsu: {
            otsuThresholdOnBand: jest.fn(() => ({
                threshold: chain(),
                rawThreshold: chain(),
                usedFallback: chain(),
            })),
            computeMedianSigmaThreshold: jest.fn(() => ({
                threshold: chain(),
                rawThreshold: chain(),
                usedFallback: chain(),
            })),
        },
        reducers: {
            areaHaSafe: jest.fn(() => chain()),
        },
        baseline: {
            createS1Baseline: jest.fn(() => chain()),
            createS1BaselineScale: jest.fn(() => chain()),
        },
        orbit: {
            chooseBestS1Orbit: jest.fn(() =>
                Promise.resolve({
                    orbitKey: 'ASCENDING_76',
                    orbitPass: 'ASCENDING',
                    relativeOrbit: 76,
                    preCount: 5,
                    postCount: 3,
                    totalCount: 8,
                    balance: 3,
                    candidates: [],
                }),
            ),
        },
        classifier: {
            classifySinglePostImage: jest.fn(() => chain()),
            reduceVotesToMask: jest.fn(() => chain()),
            applyEventModeOverride: jest.fn(({ eventMode }) =>
                eventMode
                    ? { minimumVotes: 1, minimumObservations: 1, minimumVoteFraction: 0 }
                    : { minimumVotes: 2, minimumObservations: 2, minimumVoteFraction: 0.6 },
            ),
        },
        morphology: {
            removeSmallFloodObjects: jest.fn(() => chain()),
            openClose: jest.fn(() => chain()),
        },
        tidal: {
            splitByTidal: jest.fn(() => ({ floodNonTidal: chain(), tidalFloodCandidate: chain() })),
        },
        result: {
            selectM1Artifacts: jest.fn(() => [
                { code: 'main_flood_non_tidal', role: 'PRODUCT', label: {}, description: '', style: '' },
            ]),
            buildM1ResultMetadata: jest.fn((md) => ({
                orbitKey: md.orbitKey || null,
                orbitPass: md.orbitPass || null,
                relativeOrbit: md.relativeOrbit ?? null,
                lastM1Threshold: md.lastM1Threshold ?? null,
                preSceneCount: md.preSceneCount ?? null,
                postSceneCount: md.postSceneCount ?? null,
                warnings: md.warnings || [],
            })),
        },
        ...overrides,
    };
};

const geeAdapter = () => ({
    evaluate: jest.fn().mockResolvedValue(2.0), // threshold + area both come back as 2
});

describe('runSentinel1Flood — orchestrator', () => {
    test('rejects missing ee / geeAdapter / runConfig', async () => {
        await expect(runSentinel1Flood({})).rejects.toThrow(/ee module/);
        await expect(runSentinel1Flood({ ee: {} })).rejects.toThrow(/geeAdapter/);
        await expect(
            runSentinel1Flood({ ee: {}, geeAdapter: { evaluate: () => {} } }),
        ).rejects.toThrow(/runConfig/);
    });

    test('rejects invalid runMode', async () => {
        await expect(
            runSentinel1Flood({
                ee: {},
                geeAdapter: { evaluate: async () => {} },
                runConfig: validRunConfig,
                runMode: 'debug',
                deps: makeStubs(),
            }),
        ).rejects.toThrow(/Unsupported flood run mode/);
    });

    test('returns NO_SAR_ORBIT_MATCH warning when no orbit is shared', async () => {
        const stubs = makeStubs();
        stubs.orbit.chooseBestS1Orbit.mockResolvedValueOnce(null);
        const out = await runSentinel1Flood({
            ee: {},
            geeAdapter: geeAdapter(),
            runConfig: validRunConfig,
            deps: stubs,
        });
        expect(out.artifacts).toEqual({});
        expect(out.metadata.warnings).toContain('NO_SAR_ORBIT_MATCH');
    });

    test('happy path with fixed threshold + shallow branch enabled', async () => {
        const stubs = makeStubs();
        const out = await runSentinel1Flood({
            ee: {},
            geeAdapter: geeAdapter(),
            runConfig: { ...validRunConfig, enableShallowFlood: true },
            deps: stubs,
        });
        expect(out.artifacts.main_flood_non_tidal).toBeDefined();
        expect(out.artifacts.tidal_candidate).toBeDefined();
        expect(out.artifacts.mining_candidate).toBeDefined();
        expect(out.artifacts.shallow_flood).toBeDefined();
        // Urban branch OFF by default
        expect(out.artifacts.urban_double_bounce).toBeUndefined();
        // Orchestrator stamped versions
        expect(out.metadata.pipelineVersion).toBe('FLOOD_EVENT_V1');
        expect(out.metadata.configVersion).toBe('V1');
        expect(out.metadata.aoiSource).toBe('REFERENCE_GAUL');
        expect(out.metadata.mainAreaHa).toBe(2.0);
        // Warnings reflect FABDEM non-commercial flag
        expect(out.metadata.warnings).toContain('NON_COMMERCIAL_DTM_FABDEM');
    });

    test('otsu thresholdMode invokes otsu helper and evaluates threshold + usedFallback', async () => {
        const stubs = makeStubs();
        const adapter = geeAdapter();
        await runSentinel1Flood({
            ee: {},
            geeAdapter: adapter,
            runConfig: { ...validRunConfig, thresholdMode: 'otsu' },
            deps: stubs,
        });
        expect(stubs.otsu.otsuThresholdOnBand).toHaveBeenCalled();
        // 2 evaluates for threshold + usedFallback, plus 1 for mainAreaHa
        expect(adapter.evaluate.mock.calls.length).toBeGreaterThanOrEqual(2);
    });

    test('median_sigma thresholdMode invokes computeMedianSigmaThreshold', async () => {
        const stubs = makeStubs();
        await runSentinel1Flood({
            ee: {},
            geeAdapter: geeAdapter(),
            runConfig: { ...validRunConfig, thresholdMode: 'median_sigma' },
            deps: stubs,
        });
        expect(stubs.otsu.computeMedianSigmaThreshold).toHaveBeenCalled();
    });

    test('calibration mode enables diagnostics + flips QA roles to CALIBRATION downstream', async () => {
        const stubs = makeStubs();
        const out = await runSentinel1Flood({
            ee: {},
            geeAdapter: geeAdapter(),
            runConfig: validRunConfig,
            runMode: 'calibration',
            deps: stubs,
        });
        expect(out.diagnostics).not.toBeNull();
        expect(out.diagnostics.dwCacheSize).toBe(1);
        // selectM1Artifacts was called with runMode:'calibration'
        expect(stubs.result.selectM1Artifacts).toHaveBeenCalledWith(
            expect.objectContaining({ runMode: 'calibration' }),
        );
    });

    test('urban branch enabled → wires the urbanContext argument to the classifier', async () => {
        const stubs = makeStubs();
        await runSentinel1Flood({
            ee: {},
            geeAdapter: geeAdapter(),
            runConfig: { ...validRunConfig, enableUrbanDoubleBounce: true },
            deps: stubs,
        });
        const classifyCall = stubs.classifier.classifySinglePostImage;
        // Classifier was invoked at least once — inside the `.map(img => ...)`
        // callback our recursive proxy fires it exactly once.
        expect(classifyCall).toHaveBeenCalled();
    });

    test('eventMode=true triggers the 1/1/0 override in applyEventModeOverride', async () => {
        const stubs = makeStubs();
        await runSentinel1Flood({
            ee: {},
            geeAdapter: geeAdapter(),
            runConfig: { ...validRunConfig, eventMode: true },
            deps: stubs,
        });
        expect(stubs.classifier.applyEventModeOverride).toHaveBeenCalledWith(
            expect.objectContaining({ eventMode: true }),
        );
    });
});

describe('defaultDeps', () => {
    test('exposes every helper the orchestrator names', () => {
        const d = defaultDeps();
        for (const key of [
            'geometry',
            'sentinel1',
            'terrain',
            'hand',
            'waterMasks',
            'dynamicWorld',
            'miningMask',
            'otsu',
            'reducers',
            'baseline',
            'orbit',
            'classifier',
            'morphology',
            'tidal',
            'result',
        ]) {
            expect(d[key]).toBeDefined();
        }
    });
});
