'use strict';

const analysisService = require('../analysis.service');
const floodScenarioRepo = require('../../../repositories/flood-scenario.repository');
const layerRepo = require('../../../repositories/layer.repository');
const db = require('../../../configs/database');
const {
    createScenarioSchema,
    updateScenarioSchema,
    queryScenarioSchema,
    convertLayerScenarioSchema,
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
            jest.spyOn(layerRepo, 'findByCode').mockResolvedValue({
                id: 1,
                code: 'lop_phu_sau_ngap_2015',
                name_vi: 'Lớp ngập 2015',
            });
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
            const notificationEvents = require('../../notification-events.service');
            const notifySpy = jest.spyOn(notificationEvents, 'notifyHydroScenarioTriggered').mockResolvedValue({});

            const result = await analysisService.simulateFlood({ rainfall: 150, tide: 1.5 });
            expect(result.code).toBe('lop_phu_sau_ngap_2020');
            expect(result.simulationParams.scenarioId).toBe(3);
            expect(notifySpy).toHaveBeenCalledTimes(1);
            expect(notifySpy).toHaveBeenCalledWith(
                expect.objectContaining({
                    rainVal: 150,
                    tideVal: 1.5,
                    layerCode: 'lop_phu_sau_ngap_2020',
                }),
            );
            expect(result.simulationParams.scenarioCode).toBe('scenario_heavy');
        });
    });

    describe('Scenario Type Classification and Description Encoding', () => {
        test('encodeDescription encodes type and rcp marker', () => {
            const encoded = floodScenarioRepo.encodeDescription('Mô tả ban đầu', 'quy_hoach', 'rcp85');
            expect(encoded).toBe('[[scenario:quy_hoach;rcp:rcp85]]\nMô tả ban đầu');

            const encodedClean = floodScenarioRepo.encodeDescription('[[scenario:hien_trang]]\nNội dung', 'cai_tao');
            expect(encodedClean).toBe('[[scenario:cai_tao]]\nNội dung');
        });

        test('classifyScenario extracts type from marker or falls back to text', () => {
            expect(floodScenarioRepo.classifyScenario({ description: '[[scenario:quy_hoach;rcp:rcp45]]' })).toEqual({
                type: 'quy_hoach',
                rcp: 'rcp45',
            });
            expect(floodScenarioRepo.classifyScenario({ name_vi: 'Kịch bản cải tạo thoát nước' })).toEqual({
                type: 'cai_tao',
                rcp: null,
            });
            expect(floodScenarioRepo.classifyScenario({ name_vi: 'Kịch bản quy hoạch 2050 kịch bản 8.5' })).toEqual({
                type: 'quy_hoach',
                rcp: 'rcp85',
            });
        });

        test('serialize strips marker from description and exposes virtual fields', () => {
            const row = {
                id: 5,
                code: 'kb_qh',
                name_vi: 'Quy hoạch 2050',
                description: '[[scenario:quy_hoach;rcp:rcp85]]\nMô tả kịch bản',
            };
            const serialized = floodScenarioRepo.serialize(row);
            expect(serialized.type).toBe('quy_hoach');
            expect(serialized.rcp).toBe('rcp85');
            expect(serialized.description).toBe('Mô tả kịch bản');
        });
    });

    describe('Layer Conversion to Flood Scenarios', () => {
        test('convertLayerScenarioSchema validates payload', () => {
            const valid = convertLayerScenarioSchema.validate({
                layerCodes: ['cp_sau_ngap_2020'],
                type: 'hien_trang',
                minRainfall: 100,
            });
            expect(valid.error).toBeUndefined();

            const invalid = convertLayerScenarioSchema.validate({
                layerCodes: [],
                type: 'invalid_type',
            });
            expect(invalid.error).toBeDefined();
        });

        test('convertLayersToScenarios creates scenarios and reports skipped/missing', async () => {
            const mockClient = {
                query: jest.fn().mockImplementation((sql) => {
                    if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
                        return Promise.resolve();
                    }
                    return Promise.resolve({ rows: [] });
                }),
                release: jest.fn(),
            };
            jest.spyOn(db, 'getClient').mockResolvedValue(mockClient);

            jest.spyOn(layerRepo, 'findByCodes').mockResolvedValue([
                { id: 11, code: 'cp_sau_ngap_2020', name_vi: 'Lớp ngập 2020' },
                { id: 12, code: 'cp_sau_ngap_2022', name_vi: 'Lớp ngập 2022' },
            ]);
            jest.spyOn(layerRepo, 'findByCode').mockResolvedValue({ id: 11, code: 'cp_sau_ngap_2020', name_vi: 'Lớp ngập 2020' });

            jest.spyOn(floodScenarioRepo, 'findByCode').mockImplementation((code) => {
                if (code.includes('2022')) {
                    return Promise.resolve({ id: 99, code });
                }
                return Promise.resolve(null);
            });

            jest.spyOn(floodScenarioRepo, 'create').mockResolvedValue({
                id: 50,
                code: 'scenario_hien_trang_cp_sau_ngap_2020',
                name_vi: 'Lớp ngập 2020',
                layer_code: 'cp_sau_ngap_2020',
                type: 'hien_trang',
                rcp: null,
            });

            const result = await analysisService.convertLayersToScenarios({
                layerCodes: ['cp_sau_ngap_2020', 'cp_sau_ngap_2022', 'non_existing_layer'],
                type: 'hien_trang',
                rcp: null,
                minRainfall: 50,
                maxRainfall: 100,
                minTide: null,
                maxTide: null,
                isActive: true,
            });

            expect(result.created.length).toBe(1);
            expect(result.created[0].code).toBe('scenario_hien_trang_cp_sau_ngap_2020');
            expect(result.skipped.length).toBe(1);
            expect(result.missingLayerCodes).toEqual(['non_existing_layer']);
            expect(mockClient.query).toHaveBeenCalledWith('COMMIT');
            expect(mockClient.release).toHaveBeenCalledTimes(1);
        });
    });
});

