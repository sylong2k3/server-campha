'use strict';

const analysisService = require('../analysis.service');
const floodScenarioRepo = require('../../../repositories/flood-scenario.repository');
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
                code: 'lop_phu_sau_ngap_2020',
                name_vi: 'Lớp phủ sau ngập Cẩm Phả năm 2020',
                category: 'lop-phu-ngap',
                category_name: 'Lớp phủ ngập',
                geometry_type: 'POLYGON',
                storage_kind: 'postgis',
                srid: 4326,
                geoserver_layer: 'campha:lop_phu_sau_ngap_2020',
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
                name_vi: `Lớp phủ sau ngập Cẩm Phả năm ${code.slice(-4)}`,
                geoserver_layer: `campha:${code}`,
            }));
        });

        afterEach(() => {
            jest.restoreAllMocks();
        });

        test('maps rainfall via matched scenario from DB repo', async () => {
            jest.spyOn(floodScenarioRepo, 'findMatchingScenario').mockResolvedValue({
                id: 1,
                code: 'scenario_light',
                name_vi: 'Kịch bản ngập nhẹ',
                layer_code: 'lop_phu_sau_ngap_2015',
            });

            const result = await analysisService.simulateFlood({ rainfall: 30, tide: 1.0 });
            expect(result.code).toBe('lop_phu_sau_ngap_2015');
            expect(result.isEnableDefault).toBe(true);
            expect(result.simulationParams.scenarioCode).toBe('scenario_light');
        });

        test('falls back to hardcoded thresholds if DB returns no scenario', async () => {
            jest.spyOn(floodScenarioRepo, 'findMatchingScenario').mockResolvedValue(null);

            const result = await analysisService.simulateFlood({ rainfall: 350, tide: 3.0 });
            expect(result.code).toBe('lop_phu_sau_ngap_2024');
            expect(result.isEnableDefault).toBe(true);
            expect(result.simulationParams.matchedLayerCode).toBe('lop_phu_sau_ngap_2024');
        });

        test('returns layer map structure with isEnableDefault = true', async () => {
            jest.spyOn(floodScenarioRepo, 'findMatchingScenario').mockResolvedValue({
                id: 4,
                code: 'scenario_severe',
                name_vi: 'Kịch bản ngập nghiêm trọng',
                layer_code: 'lop_phu_sau_ngap_2022',
            });

            const result = await analysisService.simulateFlood({ rainfall: 250, tide: 2.5 });
            expect(result).toMatchObject({
                id: expect.any(Number),
                code: 'lop_phu_sau_ngap_2022',
                nameVi: 'Lớp phủ sau ngập Cẩm Phả năm 2022',
                category: 'lop-phu-ngap',
                categoryName: 'Lớp phủ ngập',
                geoserverLayer: 'campha:lop_phu_sau_ngap_2022',
                isEnableDefault: true,
                simulationParams: {
                    rainfall: 250,
                    tide: 2.5,
                    scenarioId: 4,
                    scenarioCode: 'scenario_severe',
                    scenarioName: 'Kịch bản ngập nghiêm trọng',
                    matchedLayerCode: 'lop_phu_sau_ngap_2022',
                },
            });
        });
    });
});
