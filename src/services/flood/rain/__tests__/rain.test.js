'use strict';

const rainfall = require('../rainfall-source');
const riskModel = require('../risk-model');
const threshold = require('../threshold');
const result = require('../result');
const { runRainRisk, defaultDeps } = require('../index');

// Chainable proxy — with toString/toPrimitive to keep Jest's pretty-print happy.
const proxyMarks = new WeakSet();
const makeChainable = () => {
    const chain = () => {
        const p = new Proxy(function () {}, {
            get(_t, key) {
                if (key === 'then') {return undefined;}
                if (key === Symbol.toPrimitive) {return () => '[eeProxy]';}
                if (key === 'toString') {return () => '[eeProxy]';}
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
const chain = () => makeChainable();
const makeEe = () => new Proxy({}, { get() { return makeChainable(); } });

describe('rainfall-source.js', () => {
    test('IMERG_MM_PER_SCENE_FACTOR = 0.5 (Flood_D:1138)', () => {
        expect(rainfall.IMERG_MM_PER_SCENE_FACTOR).toBe(0.5);
    });
    test('accumulateIMERG requires ee + dates + aoi', () => {
        expect(() => rainfall.accumulateIMERG(null, {})).toThrow(/ee module/);
        expect(() => rainfall.accumulateIMERG(makeEe(), {})).toThrow(/startDate/);
        expect(() =>
            rainfall.accumulateIMERG(makeEe(), { startDate: 'x', endDate: 'y' }),
        ).toThrow(/aoi/);
    });
    test('buildRainfallStack returns 3h/6h/24h/72h/max/7d/30d bands from an IMERG source', () => {
        const stack = rainfall.buildRainfallStack(makeEe(), {
            eventTime: '2024-09-15T00:00:00Z',
            aoi: chain(),
        });
        for (const key of ['rain3h', 'rain6h', 'rain24h', 'rain72h', 'maxIntensity', 'rain7d', 'rain30d']) {
            expect(stack[key]).toBeDefined();
        }
    });
    test('buildRainfallStack rejects invalid eventTime', () => {
        expect(() =>
            rainfall.buildRainfallStack(makeEe(), { eventTime: 'not-a-date', aoi: chain() }),
        ).toThrow(/invalid eventTime/);
    });
    test('buildManualRainfallStack turns scalars into ee.Image wrappers', () => {
        const stack = rainfall.buildManualRainfallStack(makeEe(), {
            amount3h: 10,
            amount24h: 50,
        });
        expect(stack.rain3h).toBeDefined();
        expect(stack.rain24h).toBeDefined();
        expect(stack.rain7d).toBeNull(); // no amount7d supplied
        expect(stack.maxIntensity).toBeNull(); // MANUAL source has none
    });
});

describe('risk-model.js', () => {
    test('RISK_WEIGHTS sum to 1', () => {
        const s = Object.values(riskModel.RISK_WEIGHTS).reduce((a, v) => a + v, 0);
        expect(s).toBeCloseTo(1.0, 6);
    });
    test('PROBABILITY_CALIBRATED = false (§16 non-negotiable)', () => {
        expect(riskModel.PROBABILITY_CALIBRATED).toBe(false);
    });
    test('unitScale rejects min == max', () => {
        expect(() => riskModel.unitScale(makeEe(), chain(), { min: 1, max: 1 })).toThrow();
    });
    test('combineFactors requires every input band', () => {
        expect(() => riskModel.combineFactors(makeEe(), {})).toThrow(/rain24h/);
    });
    test('combineFactors returns a chainable image', () => {
        expect(
            riskModel.combineFactors(makeEe(), {
                rain24h: chain(),
                handImage: chain(),
                twiImage: chain(),
                slopeDeg: chain(),
                hydroDistance: chain(),
                builtDensity: chain(),
            }),
        ).toBeDefined();
    });
    test('UNIT_SCALES are locked to Flood_D:3635–3719 values', () => {
        expect(riskModel.UNIT_SCALES.rain24h).toEqual({ min: 0, max: 300 });
        expect(riskModel.UNIT_SCALES.rain7d).toEqual({ min: 0, max: 500 });
        expect(riskModel.UNIT_SCALES.handInverseMax).toBe(25);
        expect(riskModel.UNIT_SCALES.slopeInverseMax).toBe(20);
        expect(riskModel.UNIT_SCALES.twiMax).toBe(20);
        expect(riskModel.UNIT_SCALES.hydroMaxDistanceM).toBe(2000);
    });
});

describe('threshold.js', () => {
    test('CLASS_ID = {low:1, medium:2, high:3}', () => {
        expect(threshold.CLASS_ID).toEqual({ low: 1, medium: 2, high: 3 });
    });
    test('thresholdMask rejects out-of-range threshold', () => {
        expect(() => threshold.thresholdMask(makeEe(), chain(), 1.5)).toThrow();
        expect(() => threshold.thresholdMask(makeEe(), chain(), -0.1)).toThrow();
    });
    test('classifyRiskBand runs with 0.60 threshold', () => {
        expect(threshold.classifyRiskBand(makeEe(), chain(), 0.6)).toBeDefined();
    });
});

describe('result.js', () => {
    test('M3_ARTIFACTS = [rain_risk_score, rain_risk_class] both PRODUCT', () => {
        expect(result.M3_ARTIFACTS.map((a) => a.code)).toEqual([
            'rain_risk_score',
            'rain_risk_class',
        ]);
    });
    test('labels never say "Xác suất" or "Probability" (§16)', () => {
        for (const artifact of result.M3_ARTIFACTS) {
            for (const langLabel of Object.values(artifact.label)) {
                expect(langLabel.toLowerCase()).not.toMatch(/xác suất/);
                expect(langLabel.toLowerCase()).not.toMatch(/probability/);
            }
        }
    });
    test('buildM3ResultMetadata always sets PROBABILITY_CALIBRATED=false', () => {
        const md = result.buildM3ResultMetadata({});
        expect(md.PROBABILITY_CALIBRATED).toBe(false);
    });
});

// ── Orchestrator tests (DI only) ─────────────────────────────────────────

const makeStubs = () => ({
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
    reducers: {
        areaHaSafe: jest.fn(() => chain()),
        percentiles: jest.fn(() => chain()),
    },
    rainfall: {
        buildRainfallStack: jest.fn(() => ({
            rain3h: chain(), rain6h: chain(), rain24h: chain(), rain72h: chain(),
            maxIntensity: chain(), rain7d: chain(), rain30d: chain(),
        })),
        buildManualRainfallStack: jest.fn(() => ({
            rain3h: chain(), rain6h: null, rain24h: chain(), rain72h: null,
            rain7d: null, rain30d: null, maxIntensity: null,
        })),
    },
    riskModel: {
        combineFactors: jest.fn(() => chain()),
        RISK_WEIGHTS: riskModel.RISK_WEIGHTS,
    },
    threshold: {
        thresholdMask: jest.fn(() => chain()),
        classifyRiskBand: jest.fn(() => chain()),
    },
    result: {
        selectM3Artifacts: jest.fn(() => [
            { code: 'rain_risk_score', role: 'PRODUCT', label: {}, description: '', style: '' },
        ]),
        buildM3ResultMetadata: jest.fn((md) => ({ ...md, PROBABILITY_CALIBRATED: false })),
    },
});

const geeAdapter = () => ({
    evaluate: jest.fn().mockResolvedValue({ rain24h_p50: 45, chirps_total_mm_p50: 120 }),
});

describe('runRainRisk — orchestrator', () => {
    test('rejects missing ee / geeAdapter / runConfig', async () => {
        await expect(runRainRisk({})).rejects.toThrow(/ee module/);
        await expect(runRainRisk({ ee: {} })).rejects.toThrow(/geeAdapter/);
        await expect(
            runRainRisk({ ee: {}, geeAdapter: { evaluate: async () => {} } }),
        ).rejects.toThrow(/runConfig/);
    });

    test('rejects invalid runMode', async () => {
        await expect(
            runRainRisk({
                ee: {},
                geeAdapter: geeAdapter(),
                runConfig: { source: 'IMERG', eventTime: '2024-09-15T00:00:00Z' },
                runMode: 'debug',
                deps: makeStubs(),
            }),
        ).rejects.toThrow(/Unsupported flood run mode/);
    });

    test('happy path IMERG source stamps PROBABILITY_CALIBRATED=false + pipeline version', async () => {
        const stubs = makeStubs();
        const out = await runRainRisk({
            ee: {},
            geeAdapter: geeAdapter(),
            runConfig: { source: 'IMERG', eventTime: '2024-09-15T00:00:00Z' },
            deps: stubs,
        });
        expect(out.artifacts.rain_risk_score).toBeDefined();
        expect(out.artifacts.rain_risk_class).toBeDefined();
        expect(out.metadata.PROBABILITY_CALIBRATED).toBe(false);
        expect(out.metadata.pipelineVersion).toBe('RAIN_RISK_V1');
        expect(out.metadata.configVersion).toBe('V1');
        expect(stubs.rainfall.buildRainfallStack).toHaveBeenCalled();
        expect(stubs.rainfall.buildManualRainfallStack).not.toHaveBeenCalled();
    });

    test('MANUAL source uses buildManualRainfallStack, not buildRainfallStack', async () => {
        const stubs = makeStubs();
        await runRainRisk({
            ee: {},
            geeAdapter: geeAdapter(),
            runConfig: { source: 'MANUAL', rainfall: { amount24h: 50 } },
            deps: stubs,
        });
        expect(stubs.rainfall.buildManualRainfallStack).toHaveBeenCalled();
        expect(stubs.rainfall.buildRainfallStack).not.toHaveBeenCalled();
    });
});

describe('defaultDeps', () => {
    test('exposes every M3 helper', () => {
        const d = defaultDeps();
        for (const key of [
            'geometry', 'terrain', 'hand', 'waterMasks', 'dynamicWorld',
            'reducers', 'rainfall', 'riskModel', 'threshold', 'result',
        ]) {
            expect(d[key]).toBeDefined();
        }
    });
});
