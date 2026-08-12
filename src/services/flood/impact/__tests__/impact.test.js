'use strict';

const population = require('../population');
const cropland = require('../cropland');
const builtUp = require('../built-up');
const landcover = require('../landcover');
const result = require('../result');
const { runImpactAnalysis, defaultDeps } = require('../index');
const { ASSETS } = require('../../common/datasets');

const proxyMarks = new WeakSet();
const makeChainable = () => {
    const chain = () => {
        const p = new Proxy(function () {}, {
            get(_t, key) {
                if (key === 'then') {
                    return undefined;
                }
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
const chain = () => makeChainable();
const makeEe = () =>
    new Proxy(
        {},
        {
            get() {
                return makeChainable();
            },
        },
    );

describe('population.js', () => {
    test('POPULATION_SOURCE identifies GHSL_POP_2020 P2023A JRC (§55 provenance)', () => {
        expect(population.POPULATION_SOURCE).toEqual({
            dataset: ASSETS.GHSL_POP_2020,
            year: 2020,
            version: 'P2023A',
            resolutionM: 100,
            provider: 'JRC',
        });
    });
    test('loadPopulationImage instantiates the GHSL asset', () => {
        expect(population.loadPopulationImage(makeEe())).toBeDefined();
    });
    test('affectedPopulationImage rejects missing floodMask', () => {
        expect(() => population.affectedPopulationImage(makeEe(), {})).toThrow(/floodMask/);
    });
    test('affectedPopulationImage returns a chainable image', () => {
        expect(population.affectedPopulationImage(makeEe(), { floodMask: chain() })).toBeDefined();
    });
});

describe('cropland.js', () => {
    test('WC_CROPLAND_CLASS = 40 (ESA WorldCover)', () => {
        expect(cropland.WC_CROPLAND_CLASS).toBe(40);
    });
    test('CROPLAND_SOURCE identifies WorldCover v200 2021 ESA (§55)', () => {
        expect(cropland.CROPLAND_SOURCE.dataset).toBe(ASSETS.WORLDCOVER);
        expect(cropland.CROPLAND_SOURCE.year).toBe(2021);
        expect(cropland.CROPLAND_SOURCE.version).toBe('v200');
    });
    test('affectedCroplandMask requires floodMask', () => {
        expect(() => cropland.affectedCroplandMask(makeEe(), {})).toThrow(/floodMask/);
    });
});

describe('built-up.js', () => {
    test('BUILT_UP_SOURCE_TEMPLATE identifies Dynamic World V1 Google/WRI', () => {
        expect(builtUp.BUILT_UP_SOURCE_TEMPLATE.dataset).toBe(ASSETS.DYNAMIC_WORLD);
        expect(builtUp.BUILT_UP_SOURCE_TEMPLATE.version).toBe('V1');
    });
    test('buildBuiltSource stamps the caller-supplied composite year', () => {
        expect(builtUp.buildBuiltSource(2024).year).toBe(2024);
        expect(builtUp.buildBuiltSource(undefined).year).toBeNull();
    });
    test('DW_BUILT_CLASS = 6', () => {
        expect(builtUp.DW_BUILT_CLASS).toBe(6);
    });
    test('affectedBuiltMask requires floodMask + builtMask', () => {
        expect(() => builtUp.affectedBuiltMask(makeEe(), {})).toThrow(/floodMask/);
        expect(() => builtUp.affectedBuiltMask(makeEe(), { floodMask: chain() })).toThrow(
            /builtMask/,
        );
    });
});

describe('landcover.js', () => {
    test('WC_CLASS_LABELS covers every ESA WorldCover class present in the raster', () => {
        for (const cls of [10, 20, 30, 40, 50, 60, 70, 80, 90, 95, 100]) {
            expect(landcover.WC_CLASS_LABELS[cls]).toBeDefined();
        }
    });
    test('summariseLandcoverGroups converts a grouped reducer output to per-class rows', () => {
        const rows = landcover.summariseLandcoverGroups({
            groups: [
                { class: 40, sum: 12.5 },
                { class: 80, sum: 3.2 },
                { class: 999, sum: 0.1 }, // unknown code — still returned with a Class-N label
            ],
        });
        expect(rows).toHaveLength(3);
        expect(rows[0]).toMatchObject({ class: 40, areaHa: 12.5 });
        expect(rows[0].label.en).toBe('Cropland');
        expect(rows[2].label.en).toBe('Class 999');
    });
    test('summariseLandcoverGroups tolerates missing/empty input', () => {
        expect(landcover.summariseLandcoverGroups(null)).toEqual([]);
        expect(landcover.summariseLandcoverGroups({})).toEqual([]);
    });
});

describe('result.js', () => {
    test('M4_QA_ARTIFACTS = [population, cropland, built] — all QA', () => {
        expect(result.M4_QA_ARTIFACTS.map((a) => a.code)).toEqual([
            'affected_population',
            'affected_cropland',
            'affected_built',
        ]);
        for (const a of result.M4_QA_ARTIFACTS) {
            expect(a.role).toBe('QA');
        }
    });
    test('selectM4Artifacts flips QA→CALIBRATION in calibration mode', () => {
        for (const a of result.selectM4Artifacts({ runMode: 'calibration' })) {
            expect(a.role).toBe('CALIBRATION');
        }
    });
    test('buildM4ResultMetadata always includes the four data-source stamps', () => {
        const md = result.buildM4ResultMetadata({ sourceType: 'M1', dwCompositeYear: 2024 });
        expect(md.sources.population.dataset).toBe(ASSETS.GHSL_POP_2020);
        expect(md.sources.cropland.dataset).toBe(ASSETS.WORLDCOVER);
        expect(md.sources.landcover.dataset).toBe(ASSETS.WORLDCOVER);
        expect(md.sources.builtUp.dataset).toBe(ASSETS.DYNAMIC_WORLD);
        expect(md.sources.builtUp.year).toBe(2024);
    });
    test('buildM4ResultMetadata rounds affectedPopulation to an integer', () => {
        const md = result.buildM4ResultMetadata({
            sourceType: 'M1',
            affectedPopulation: 1234.56,
        });
        expect(md.affectedPopulation).toBe(1235);
    });
    test('buildM4ResultMetadata drops non-finite fields to null', () => {
        const md = result.buildM4ResultMetadata({
            sourceType: 'M1',
            floodAreaHa: 'x',
            affectedCroplandHa: undefined,
        });
        expect(md.floodAreaHa).toBeNull();
        expect(md.affectedCroplandHa).toBeNull();
    });
});

// ── Orchestrator tests ───────────────────────────────────────────────────

const makeStubs = () => ({
    geometry: {
        loadAoi: jest.fn(() => ({ fc: chain(), geometry: chain(), source: 'REFERENCE_GAUL' })),
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
        areaHaByClass: jest.fn(() => chain()),
    },
    population: {
        affectedPopulationImage: jest.fn(() => chain()),
    },
    cropland: {
        affectedCroplandMask: jest.fn(() => chain()),
    },
    builtUp: {
        affectedBuiltMask: jest.fn(() => chain()),
    },
    landcover: {
        loadLandcoverImage: jest.fn(() => chain()),
        summariseLandcoverGroups: jest.fn(() => [{ class: 40, label: {}, areaHa: 12.5 }]),
    },
    result: {
        selectM4Artifacts: jest.fn(() => [
            { code: 'affected_population', role: 'QA', label: {}, description: '', style: '' },
        ]),
        buildM4ResultMetadata: jest.fn((md) => ({
            ...md,
            sources: { population: {}, cropland: {}, landcover: {}, builtUp: {} },
        })),
    },
});

const geeAdapter = (value = 100) => ({
    evaluate: jest
        .fn()
        .mockResolvedValue({
            affected_population: 42000,
        })
        .mockResolvedValueOnce(value)
        .mockResolvedValueOnce({ affected_population: 42000 })
        .mockResolvedValueOnce(value)
        .mockResolvedValueOnce(value)
        .mockResolvedValueOnce({ groups: [] }),
});

describe('runImpactAnalysis — orchestrator', () => {
    test('rejects missing ee / geeAdapter / runConfig / sourceFloodMask / sourceType', async () => {
        await expect(runImpactAnalysis({})).rejects.toThrow(/ee module/);
        await expect(runImpactAnalysis({ ee: {} })).rejects.toThrow(/geeAdapter/);
        await expect(
            runImpactAnalysis({ ee: {}, geeAdapter: { evaluate: async () => {} } }),
        ).rejects.toThrow(/runConfig/);
        await expect(
            runImpactAnalysis({
                ee: makeEe(),
                geeAdapter: geeAdapter(),
                runConfig: {},
                deps: makeStubs(),
            }),
        ).rejects.toThrow(/sourceFloodMask/);
        await expect(
            runImpactAnalysis({
                ee: makeEe(),
                geeAdapter: geeAdapter(),
                runConfig: {},
                sourceFloodMask: chain(),
                deps: makeStubs(),
            }),
        ).rejects.toThrow(/sourceType/);
    });

    test('rejects invalid runMode / sourceType', async () => {
        await expect(
            runImpactAnalysis({
                ee: makeEe(),
                geeAdapter: geeAdapter(),
                runConfig: {},
                sourceFloodMask: chain(),
                sourceType: 'M99',
                deps: makeStubs(),
            }),
        ).rejects.toThrow(/sourceType/);
        await expect(
            runImpactAnalysis({
                ee: makeEe(),
                geeAdapter: geeAdapter(),
                runConfig: {},
                sourceFloodMask: chain(),
                sourceType: 'M1',
                runMode: 'debug',
                deps: makeStubs(),
            }),
        ).rejects.toThrow(/Unsupported flood run mode/);
    });

    test('happy path returns population + cropland + built QA artifacts + metadata', async () => {
        const stubs = makeStubs();
        const out = await runImpactAnalysis({
            ee: makeEe(),
            geeAdapter: geeAdapter(),
            runConfig: {},
            sourceFloodMask: chain(),
            sourceType: 'M1',
            sourceRunId: 42,
            dwCompositeYear: 2024,
            deps: stubs,
        });
        expect(out.artifacts.affected_population).toBeDefined();
        expect(out.artifacts.affected_cropland).toBeDefined();
        expect(out.artifacts.affected_built).toBeDefined();
        expect(out.metadata.pipelineVersion).toBe('IMPACT_V1');
        expect(out.metadata.configVersion).toBe('V1');
        expect(out.metadata.aoiSource).toBe('REFERENCE_GAUL');
        // The buildM4ResultMetadata mock recorded the sourceType we passed.
        const metaArg = stubs.result.buildM4ResultMetadata.mock.calls[0][0];
        expect(metaArg.sourceType).toBe('M1');
        expect(metaArg.sourceRunId).toBe(42);
        expect(metaArg.dwCompositeYear).toBe(2024);
    });
});

describe('defaultDeps', () => {
    test('exposes every M4 helper', () => {
        const d = defaultDeps();
        for (const key of [
            'geometry',
            'dynamicWorld',
            'reducers',
            'population',
            'cropland',
            'builtUp',
            'landcover',
            'result',
        ]) {
            expect(d[key]).toBeDefined();
        }
    });
});
