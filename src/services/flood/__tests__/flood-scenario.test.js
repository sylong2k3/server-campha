'use strict';

const analysisService = require('../analysis.service');
const floodScenarioRepo = require('../../../repositories/flood-scenario.repository');
const layerRepo = require('../../../repositories/layer.repository');
const {
    createScenarioSchema,
    updateScenarioSchema,
    queryScenarioSchema,
} = require('../../../validators/flood.validator');

describe('Flood Scenario Management CRUD', () => {
    describe('Validator Schemas', () => {
        test('createScenarioSchema validates required fields', () => {
            const payload = {
                code: 'scenario_test',
                nameVi: 'Kịch bản thử nghiệm',
                layerCode: 'lop_phu_sau_ngap_2020',
            };
            const { error, value } = createScenarioSchema.validate(payload);
            expect(error).toBeUndefined();
            expect(value.code).toBe('scenario_test');
            expect(value.minRainfall).toBe(0.0);
            expect(value.isActive).toBe(true);
        });

        test('createScenarioSchema fails when missing required fields', () => {
            const { error } = createScenarioSchema.validate({ code: 'scenario_test' });
            expect(error).toBeDefined();
            expect(error.details[0].message).toContain('Tên kịch bản');
        });

        test('updateScenarioSchema allows partial updates', () => {
            const { error, value } = updateScenarioSchema.validate({ nameVi: 'Tên mới', isActive: false });
            expect(error).toBeUndefined();
            expect(value.nameVi).toBe('Tên mới');
            expect(value.isActive).toBe(false);
        });

        test('queryScenarioSchema applies default pagination', () => {
            const { error, value } = queryScenarioSchema.validate({});
            expect(error).toBeUndefined();
            expect(value.page).toBe(1);
            expect(value.limit).toBe(20);
        });
    });

    describe('Service Layer Scenario CRUD Operations', () => {
        let mockScenario;

        beforeEach(() => {
            mockScenario = {
                id: 1,
                code: 'scenario_light',
                name_vi: 'Kịch bản ngập nhẹ',
                min_rainfall: 0,
                max_rainfall: 49.99,
                min_tide: null,
                max_tide: 1.99,
                layer_code: 'lop_phu_sau_ngap_2015',
                description: 'Mô tả',
                is_active: true,
            };
        });

        afterEach(() => {
            jest.restoreAllMocks();
        });

        test('listScenarios calls repository listAll', async () => {
            jest.spyOn(floodScenarioRepo, 'listAll').mockResolvedValue({
                items: [mockScenario],
                pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
            });

            const result = await analysisService.listScenarios({});
            expect(result.items.length).toBe(1);
            expect(result.items[0].code).toBe('scenario_light');
        });

        test('getScenario returns scenario when found', async () => {
            jest.spyOn(floodScenarioRepo, 'findById').mockResolvedValue(mockScenario);

            const result = await analysisService.getScenario(1);
            expect(result.id).toBe(1);
        });

        test('getScenario throws 404 when not found', async () => {
            jest.spyOn(floodScenarioRepo, 'findById').mockResolvedValue(null);

            await expect(analysisService.getScenario(999)).rejects.toThrow('Không tìm thấy kịch bản');
        });

        test('createScenario validates code uniqueness and layer existence', async () => {
            jest.spyOn(floodScenarioRepo, 'findByCode').mockResolvedValue(null);
            jest.spyOn(layerRepo, 'findByCode').mockResolvedValue({ id: 10, code: 'lop_phu_sau_ngap_2020' });
            jest.spyOn(floodScenarioRepo, 'create').mockResolvedValue({ ...mockScenario, id: 2 });

            const result = await analysisService.createScenario({
                code: 'new_code',
                nameVi: 'Tên mới',
                layerCode: 'lop_phu_sau_ngap_2020',
            });
            expect(result.id).toBe(2);
        });

        test('createScenario throws 409 on duplicate code', async () => {
            jest.spyOn(floodScenarioRepo, 'findByCode').mockResolvedValue(mockScenario);

            await expect(
                analysisService.createScenario({
                    code: 'scenario_light',
                    nameVi: 'Tên mới',
                    layerCode: 'lop_phu_sau_ngap_2020',
                }),
            ).rejects.toThrow("Mã kịch bản 'scenario_light' đã tồn tại");
        });

        test('createScenario throws 404 if linked layer does not exist', async () => {
            jest.spyOn(floodScenarioRepo, 'findByCode').mockResolvedValue(null);
            jest.spyOn(layerRepo, 'findByCode').mockResolvedValue(null);

            await expect(
                analysisService.createScenario({
                    code: 'new_code',
                    nameVi: 'Tên mới',
                    layerCode: 'non_existent_layer',
                }),
            ).rejects.toThrow("Không tìm thấy lớp bản đồ liên kết 'non_existent_layer'");
        });

        test('deleteScenario throws 404 if scenario does not exist', async () => {
            jest.spyOn(floodScenarioRepo, 'findById').mockResolvedValue(null);

            await expect(analysisService.deleteScenario(999)).rejects.toThrow('Không tìm thấy kịch bản');
        });
    });

    describe('Dynamic Flood Simulation Scenario Matching', () => {
        afterEach(() => {
            jest.restoreAllMocks();
        });

        test('simulateFlood maps rainfall via matched scenario from DB repo', async () => {
            jest.spyOn(floodScenarioRepo, 'findMatchingScenario').mockResolvedValue({
                id: 3,
                code: 'scenario_heavy',
                name_vi: 'Kịch bản ngập nặng',
                layer_code: 'lop_phu_sau_ngap_2020',
            });
            jest.spyOn(layerRepo, 'findByCode').mockResolvedValue({
                id: 10,
                code: 'lop_phu_sau_ngap_2020',
                name_vi: 'Lớp phủ sau ngập Cẩm Phả năm 2020',
                category: 'lop-phu-ngap',
                category_name: 'Lớp phủ ngập',
            });

            const result = await analysisService.simulateFlood({ rainfall: 150, tide: 1.5 });
            expect(result.code).toBe('lop_phu_sau_ngap_2020');
            expect(result.simulationParams.scenarioId).toBe(3);
            expect(result.simulationParams.scenarioCode).toBe('scenario_heavy');
        });
    });
});
