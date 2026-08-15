'use strict';

const analysisService = require('../analysis.service');
const layerRepo = require('../../../repositories/layer.repository');
const { simulationSchema } = require('../../../validators/flood.validator');

describe('Flood Simulation Service & Validator', () => {
    describe('simulationSchema Validation', () => {
        test('validates required rainfall parameter', () => {
            const { error, value } = simulationSchema.validate({ rainfall: 120, tide: 2.5 });
            expect(error).toBeUndefined();
            expect(value.rainfall).toBe(120);
            expect(value.tide).toBe(2.5);
        });

        test('allows optional tide parameter to be omitted', () => {
            const { error, value } = simulationSchema.validate({ rainfall: 75 });
            expect(error).toBeUndefined();
            expect(value.rainfall).toBe(75);
            expect(value.tide).toBeNull();
        });

        test('fails when rainfall is missing', () => {
            const { error } = simulationSchema.validate({ tide: 1.5 });
            expect(error).toBeDefined();
            expect(error.details[0].message).toContain('Lượng mưa');
        });

        test('fails when rainfall is negative', () => {
            const { error } = simulationSchema.validate({ rainfall: -10 });
            expect(error).toBeDefined();
        });
    });

    describe('simulateFlood Logic', () => {
        let mockLayer;

        beforeEach(() => {
            mockLayer = {
                id: 101,
                code: 'script_scenario_3',
                name_vi: 'Kịch bản 3',
                category: 'script',
                category_name: 'Kịch bản ngập úng',
                geometry_type: 'POLYGON',
                storage_kind: 'postgis',
                srid: 4326,
                geoserver_layer: 'campha:script_scenario_3',
                style_name: 'forecast_flood_mask',
                min_zoom: 0,
                max_zoom: 24,
                legend_config: {},
                is_public: true,
                is_enable_default: false,
            };
            jest.spyOn(layerRepo, 'findByCode').mockImplementation(async (code) => ({
                ...mockLayer,
                code,
                name_vi: `Kịch bản ${code.slice(-1)}`,
                geoserver_layer: `campha:${code}`,
            }));
        });

        afterEach(() => {
            jest.restoreAllMocks();
        });

        test('maps low rainfall (<50mm) without high tide to Scenario 1', async () => {
            const result = await analysisService.simulateFlood({ rainfall: 30, tide: 1.0 });
            expect(result.code).toBe('script_scenario_1');
            expect(result.isEnableDefault).toBe(true);
            expect(result.simulationParams.scenarioIndex).toBe(1);
        });

        test('promotes Scenario 1 to Scenario 2 when tide >= 2.0m', async () => {
            const result = await analysisService.simulateFlood({ rainfall: 30, tide: 2.5 });
            expect(result.code).toBe('script_scenario_2');
            expect(result.isEnableDefault).toBe(true);
            expect(result.simulationParams.scenarioIndex).toBe(2);
        });

        test('maps moderate rainfall (50-99mm) to Scenario 2', async () => {
            const result = await analysisService.simulateFlood({ rainfall: 80 });
            expect(result.code).toBe('script_scenario_2');
            expect(result.isEnableDefault).toBe(true);
        });

        test('maps heavy rainfall (100-199mm) to Scenario 3', async () => {
            const result = await analysisService.simulateFlood({ rainfall: 150 });
            expect(result.code).toBe('script_scenario_3');
            expect(result.isEnableDefault).toBe(true);
        });

        test('maps heavy rainfall (100-199mm) + high tide to Scenario 4', async () => {
            const result = await analysisService.simulateFlood({ rainfall: 150, tide: 2.2 });
            expect(result.code).toBe('script_scenario_4');
            expect(result.isEnableDefault).toBe(true);
        });

        test('maps very heavy rainfall (200-299mm) to Scenario 4', async () => {
            const result = await analysisService.simulateFlood({ rainfall: 250 });
            expect(result.code).toBe('script_scenario_4');
            expect(result.isEnableDefault).toBe(true);
        });

        test('maps extreme rainfall (>=300mm) capped at Scenario 5', async () => {
            const result = await analysisService.simulateFlood({ rainfall: 350, tide: 3.0 });
            expect(result.code).toBe('script_scenario_5');
            expect(result.isEnableDefault).toBe(true);
            expect(result.simulationParams.scenarioIndex).toBe(5);
        });

        test('returns layer map structure with isEnableDefault = true', async () => {
            const result = await analysisService.simulateFlood({ rainfall: 120, tide: 2.5 });
            expect(result).toMatchObject({
                id: expect.any(Number),
                code: 'script_scenario_4',
                nameVi: 'Kịch bản 4',
                category: 'script',
                categoryName: 'Kịch bản ngập úng',
                geoserverLayer: 'campha:script_scenario_4',
                isEnableDefault: true,
                simulationParams: {
                    rainfall: 120,
                    tide: 2.5,
                    scenarioIndex: 4,
                    scenarioCode: 'script_scenario_4',
                    scenarioName: 'Kịch bản 4',
                },
            });
        });
    });
});
