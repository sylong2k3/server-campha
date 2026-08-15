'use strict';

const analysisService = require('../analysis.service');
const floodScenarioRepo = require('../../../repositories/flood-scenario.repository');
const layerRepo = require('../../../repositories/layer.repository');
const {
    createScenarioSchema,
    updateScenarioSchema,
    queryScenarioSchema,
} = require('../../../validators/flood.validator');

describe('Flood Scenario Management & Dynamic Simulation', () => {
    describe('Scenario Validator Schemas', () => {
        test('validates createScenarioSchema successfully', () => {
            const { error, value } = createScenarioSchema.validate({
                code: 'test_scenario_1',
                nameVi: 'Kịch bản thử nghiệm',
                minRainfall: 10,
                maxRainfall: 50,
                layerCode: 'lop_phu_sau_ngap_2020',
            });
            expect(error).toBeUndefined();
            expect(value.code).toBe('test_scenario_1');
            expect(value.isActive).toBe(true);
        });

        test('fails createScenarioSchema when required fields missing', () => {
            const { error } = createScenarioSchema.validate({
                minRainfall: 10,
            });
            expect(error).toBeDefined();
        });

        test('validates updateScenarioSchema with partial fields', () => {
            const { error, value } = updateScenarioSchema.validate({
                nameVi: 'Tên kịch bản mới',
                minRainfall: 15,
            });
            expect(error).toBeUndefined();
            expect(value.nameVi).toBe('Tên kịch bản mới');
        });

        test('validates queryScenarioSchema pagination defaults', () => {
            const { error, value } = queryScenarioSchema.validate({});
            expect(error).toBeUndefined();
            expect(value.page).toBe(1);
            expect(value.limit).toBe(20);
        });
    });

    describe('Scenario Service CRUD Operations', () => {
        const mockScenario = {
            id: 1,
            code: 'scenario_light',
            name_vi: 'Kịch bản ngập nhẹ',
            min_rainfall: '0.00',
            max_rainfall: '49.99',
            layer_code: 'lop_phu_sau_ngap_2015',
            is_active: true,
        };

        const mockLayer = {
            id: 10,
            code: 'lop_phu_sau_ngap_2015',
            name_vi: 'Lớp phủ sau ngập 2015',
            geoserver_layer: 'campha:lop_phu_sau_ngap_2015',
        };

        afterEach(() => {
            jest.restoreAllMocks();
        });

        test('listScenarios calls repository listAll', async () => {
            jest.spyOn(floodScenarioRepo, 'listAll').mockResolvedValue({
                items: [mockScenario],
                pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
            });

            const result = await analysisService.listScenarios();
            expect(result.items).toHaveLength(1);
            expect(floodScenarioRepo.listAll).toHaveBeenCalled();
        });

        test('getScenario returns scenario when exists', async () => {
            jest.spyOn(floodScenarioRepo, 'findById').mockResolvedValue(mockScenario);

            const result = await analysisService.getScenario(1);
            expect(result.id).toBe(1);
        });

        test('getScenario throws Api404Error when not found', async () => {
            jest.spyOn(floodScenarioRepo, 'findById').mockResolvedValue(null);

            await expect(analysisService.getScenario(999)).rejects.toThrow('Không tìm thấy kịch bản');
        });

        test('createScenario validates code uniqueness and layer existence', async () => {
            jest.spyOn(floodScenarioRepo, 'findByCode').mockResolvedValue(null);
            jest.spyOn(layerRepo, 'findByCode').mockResolvedValue(mockLayer);
            jest.spyOn(floodScenarioRepo, 'create').mockResolvedValue(mockScenario);

            const payload = {
                code: 'scenario_light',
                nameVi: 'Kịch bản ngập nhẹ',
                layerCode: 'lop_phu_sau_ngap_2015',
            };

            const result = await analysisService.createScenario(payload);
            expect(result.code).toBe('scenario_light');
            expect(floodScenarioRepo.create).toHaveBeenCalledWith(payload);
        });

        test('createScenario throws 409 when code duplicate', async () => {
            jest.spyOn(floodScenarioRepo, 'findByCode').mockResolvedValue(mockScenario);

            await expect(
                analysisService.createScenario({
                    code: 'scenario_light',
                    nameVi: 'Kịch bản ngập nhẹ',
                    layerCode: 'lop_phu_sau_ngap_2015',
                }),
            ).rejects.toThrow('đã tồn tại');
        });

        test('updateScenario updates existing scenario', async () => {
            jest.spyOn(floodScenarioRepo, 'findById').mockResolvedValue(mockScenario);
            jest.spyOn(floodScenarioRepo, 'update').mockResolvedValue({
                ...mockScenario,
                name_vi: 'Tên đã sửa',
            });

            const result = await analysisService.updateScenario(1, { nameVi: 'Tên đã sửa' });
            expect(result.name_vi).toBe('Tên đã sửa');
        });

        test('deleteScenario removes scenario', async () => {
            jest.spyOn(floodScenarioRepo, 'findById').mockResolvedValue(mockScenario);
            jest.spyOn(floodScenarioRepo, 'deleteScenario').mockResolvedValue(true);

            const result = await analysisService.deleteScenario(1);
            expect(result).toBe(true);
        });
    });

    describe('Dynamic Simulation Matching via DB Scenarios', () => {
        const mockScenario = {
            id: 3,
            code: 'scenario_heavy',
            name_vi: 'Kịch bản ngập cao',
            min_rainfall: '100.00',
            max_rainfall: '199.99',
            layer_code: 'lop_phu_sau_ngap_2020',
            is_active: true,
        };

        const mockLayer = {
            id: 30,
            code: 'lop_phu_sau_ngap_2020',
            name_vi: 'Lớp phủ sau ngập 2020',
            geoserver_layer: 'campha:lop_phu_sau_ngap_2020',
        };

        afterEach(() => {
            jest.restoreAllMocks();
        });

        test('simulateFlood uses matched scenario from DB repo', async () => {
            jest.spyOn(floodScenarioRepo, 'findMatchingScenario').mockResolvedValue(mockScenario);
            jest.spyOn(layerRepo, 'findByCode').mockResolvedValue(mockLayer);

            const result = await analysisService.simulateFlood({ rainfall: 150, tide: 1.5 });
            expect(result.simulationParams.scenarioCode).toBe('scenario_heavy');
            expect(result.simulationParams.matchedLayerCode).toBe('lop_phu_sau_ngap_2020');
            expect(result.isEnableDefault).toBe(true);
        });
    });
});
