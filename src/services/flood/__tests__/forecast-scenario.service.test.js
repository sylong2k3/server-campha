'use strict';

jest.mock('../../../repositories/flood-forecast.repository');
jest.mock('../../../repositories/flood-scenario.repository');
jest.mock('../../notification-events.service');
jest.mock('../../../utils/systemLogger.util', () => ({
    logInfo: jest.fn(),
    logError: jest.fn(),
    logWarn: jest.fn(),
    logDebug: jest.fn(),
}));

const floodForecastRepo = require('../../../repositories/flood-forecast.repository');
const floodScenarioRepo = require('../../../repositories/flood-scenario.repository');
const notificationEvents = require('../../notification-events.service');
const forecastScenarioService = require('../forecast-scenario.service');

describe('forecast-scenario.service', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        floodScenarioRepo.listAll.mockResolvedValue({ items: [] });
    });

    test('returns 0 processed when no slots are due', async () => {
        floodForecastRepo.getDuePendingSlots.mockResolvedValue([]);

        const res = await forecastScenarioService.processDueScheduleSlots();
        expect(res).toEqual({ processed: 0, applied: 0, skipped: 0, errors: 0 });
        expect(floodScenarioRepo.findMatchingScenario).not.toHaveBeenCalled();
    });

    test('applies matching scenario and sends notification when chance > 50% and precip > 0', async () => {
        const slot = {
            id: 101,
            forecast_date: '2026-09-18',
            hour_str: '08:00',
            scheduled_time: new Date('2026-09-18T08:00:00+07:00'),
            chance_of_rain: 75,
            precip_mm: 45.5,
            status: 'PENDING',
        };
        floodForecastRepo.getDuePendingSlots.mockResolvedValue([slot]);

        const matched = {
            id: 3,
            code: 'scenario_moderate',
            name_vi: 'Kịch bản ngập vừa',
            min_rainfall: 40,
            max_rainfall: 80,
            layer_code: 'lop_phu_sau_ngap_2018',
            type: 'hien_trang',
        };
        floodScenarioRepo.findMatchingScenario.mockResolvedValue(matched);
        floodScenarioRepo.update.mockResolvedValue({ ...matched, isActive: true });
        floodForecastRepo.updateScheduleSlot.mockResolvedValue({ ...slot, status: 'APPLIED' });
        notificationEvents.notifyHydroScenarioTriggered.mockResolvedValue({ recipientCount: 4 });

        const res = await forecastScenarioService.processDueScheduleSlots();

        expect(res.processed).toBe(1);
        expect(res.applied).toBe(1);
        expect(res.skipped).toBe(0);
        expect(res.errors).toBe(0);

        expect(floodScenarioRepo.findMatchingScenario).toHaveBeenCalledWith(45.5, null, undefined, {
            type: 'hien_trang',
        });
        expect(floodScenarioRepo.update).toHaveBeenCalledWith(3, {
            isActive: true,
            currentRainfall: 45.5,
            rainfallSource: 'AUTO',
        });
        expect(floodForecastRepo.updateScheduleSlot).toHaveBeenCalledWith(101, {
            status: 'APPLIED',
            appliedScenarioId: 3,
        });
        expect(notificationEvents.notifyHydroScenarioTriggered).toHaveBeenCalledWith(
            expect.objectContaining({
                scenario: matched,
                layerCode: 'lop_phu_sau_ngap_2018',
                rainVal: 45.5,
                source: 'AUTO',
            }),
        );
    });

    test('skips slot and deactivates active current-state scenarios when chance of rain <= 50%', async () => {
        const slot = {
            id: 102,
            forecast_date: '2026-09-18',
            hour_str: '09:00',
            scheduled_time: new Date('2026-09-18T09:00:00+07:00'),
            chance_of_rain: 45, // <= 50%
            precip_mm: 20.0,
            status: 'PENDING',
        };
        floodForecastRepo.getDuePendingSlots.mockResolvedValue([slot]);
        floodScenarioRepo.deactivateAllActive.mockResolvedValue([{ id: 9 }]);

        const res = await forecastScenarioService.processDueScheduleSlots();

        expect(res.processed).toBe(1);
        expect(res.applied).toBe(0);
        expect(res.skipped).toBe(1);
        expect(floodScenarioRepo.findMatchingScenario).not.toHaveBeenCalled();
        expect(floodScenarioRepo.deactivateAllActive).toHaveBeenCalledWith({ types: ['hien_trang'] });
        expect(floodForecastRepo.updateScheduleSlot).toHaveBeenCalledWith(102, {
            status: 'SKIPPED',
            appliedScenarioId: null,
        });
        expect(notificationEvents.notifyHydroScenarioTriggered).not.toHaveBeenCalled();
    });

    test('skips slot and deactivates all active scenarios when precip_mm is 0 even if chance > 50%', async () => {
        const slot = {
            id: 103,
            forecast_date: '2026-09-18',
            hour_str: '10:00',
            chance_of_rain: 60,
            precip_mm: 0,
            status: 'PENDING',
        };
        floodForecastRepo.getDuePendingSlots.mockResolvedValue([slot]);
        floodScenarioRepo.deactivateAllActive.mockResolvedValue([{ id: 13 }, { id: 14 }]);

        const res = await forecastScenarioService.processDueScheduleSlots();

        expect(res.applied).toBe(0);
        expect(res.skipped).toBe(1);
        expect(floodScenarioRepo.findMatchingScenario).not.toHaveBeenCalled();
        expect(floodScenarioRepo.deactivateAllActive).toHaveBeenCalledWith();
        expect(floodForecastRepo.updateScheduleSlot).toHaveBeenCalledWith(103, {
            status: 'SKIPPED',
            appliedScenarioId: null,
        });
    });

    test('handles slot error gracefully and marks slot FAILED', async () => {
        const slot = {
            id: 104,
            forecast_date: '2026-09-18',
            hour_str: '11:00',
            chance_of_rain: 80,
            precip_mm: 35.0,
            status: 'PENDING',
        };
        floodForecastRepo.getDuePendingSlots.mockResolvedValue([slot]);
        floodScenarioRepo.findMatchingScenario.mockRejectedValue(new Error('DB read error'));

        const res = await forecastScenarioService.processDueScheduleSlots();

        expect(res.errors).toBe(1);
        expect(floodForecastRepo.updateScheduleSlot).toHaveBeenCalledWith(104, {
            status: 'FAILED',
            appliedScenarioId: null,
        });
    });

    test('skips slot when slot has is_manual_override or status is MANUAL', async () => {
        const slot = {
            id: 105,
            forecast_date: '2026-09-18',
            hour_str: '12:00',
            chance_of_rain: 90,
            precip_mm: 50.0,
            status: 'MANUAL',
            is_manual_override: true,
        };
        floodForecastRepo.getDuePendingSlots.mockResolvedValue([slot]);

        const res = await forecastScenarioService.processDueScheduleSlots();

        expect(res.processed).toBe(1);
        expect(res.applied).toBe(0);
        expect(res.skipped).toBe(0);
        expect(floodScenarioRepo.findMatchingScenario).not.toHaveBeenCalled();
        expect(floodForecastRepo.updateScheduleSlot).not.toHaveBeenCalled();
    });

    test('does not send notification if scenario was already active in processDueScheduleSlots', async () => {
        const slot = {
            id: 106,
            forecast_date: '2026-09-18',
            hour_str: '13:00',
            chance_of_rain: 80,
            precip_mm: 30.0,
            status: 'PENDING',
        };
        floodForecastRepo.getDuePendingSlots.mockResolvedValue([slot]);

        const matched = {
            id: 2,
            code: 'scenario_light',
            name_vi: 'Kịch bản ngập nhẹ',
            layer_code: 'layer_light',
            type: 'hien_trang',
            is_active: true, // Already active
        };
        floodScenarioRepo.findMatchingScenario.mockResolvedValue(matched);
        floodScenarioRepo.listAll.mockResolvedValue({ items: [matched] });
        floodScenarioRepo.update.mockResolvedValue({ ...matched, isActive: true });
        floodForecastRepo.updateScheduleSlot.mockResolvedValue({ ...slot, status: 'APPLIED' });

        const res = await forecastScenarioService.processDueScheduleSlots();

        expect(res.applied).toBe(1);
        expect(floodScenarioRepo.update).toHaveBeenCalledWith(2, {
            isActive: true,
            currentRainfall: 30.0,
            rainfallSource: 'AUTO',
        });
        // Crucial: notification must NOT be called because scenario was already active
        expect(notificationEvents.notifyHydroScenarioTriggered).not.toHaveBeenCalled();
    });

    describe('applyManualOverride', () => {
        test('sets scenario to MANUAL and locks slot with manual override', async () => {
            const targetScenario = {
                id: 5,
                code: 'scenario_heavy',
                name_vi: 'Kịch bản ngập nặng',
                layer_code: 'layer_heavy',
                type: 'hien_trang',
                is_active: false,
            };
            floodScenarioRepo.findById.mockResolvedValue(targetScenario);
            floodScenarioRepo.listAll.mockResolvedValue({ items: [] });
            floodScenarioRepo.update.mockResolvedValue({ ...targetScenario, is_active: true });
            floodForecastRepo.setSlotManualOverride.mockResolvedValue({
                id: 10,
                status: 'MANUAL',
                is_manual_override: true,
            });

            const result = await forecastScenarioService.applyManualOverride({
                hour: '14:00',
                date: '2026-09-18',
                rainfall: 120,
                tide: 1.5,
                scenarioId: 5,
            });

            expect(result.success).toBe(true);
            expect(floodScenarioRepo.update).toHaveBeenCalledWith(5, {
                isActive: true,
                currentRainfall: 120,
                rainfallSource: 'MANUAL',
                currentTide: 1.5,
                tideSource: 'MANUAL',
            });
            expect(floodForecastRepo.setSlotManualOverride).toHaveBeenCalledWith({
                forecastDate: '2026-09-18',
                hourStr: '14:00',
                rainfall: 120,
                scenarioId: 5,
            });
            // Newly activated scenario triggers notification
            expect(notificationEvents.notifyHydroScenarioTriggered).toHaveBeenCalledWith(
                expect.objectContaining({
                    layerCode: 'layer_heavy',
                    rainVal: 120,
                    source: 'MANUAL',
                }),
            );
        });

        test('does not send notification if manually activated scenario was already active', async () => {
            const activeScenario = {
                id: 5,
                code: 'scenario_heavy',
                name_vi: 'Kịch bản ngập nặng',
                layer_code: 'layer_heavy',
                type: 'hien_trang',
                is_active: true, // already active
            };
            floodScenarioRepo.findById.mockResolvedValue(activeScenario);
            floodScenarioRepo.listAll.mockResolvedValue({ items: [activeScenario] });
            floodScenarioRepo.update.mockResolvedValue(activeScenario);
            floodForecastRepo.setSlotManualOverride.mockResolvedValue({ id: 10 });

            await forecastScenarioService.applyManualOverride({
                hour: '15:00',
                date: '2026-09-18',
                rainfall: 100,
                scenarioId: 5,
            });

            expect(notificationEvents.notifyHydroScenarioTriggered).not.toHaveBeenCalled();
        });

        test('locks a zero-rainfall hour as MANUAL and deactivates all active scenarios', async () => {
            floodScenarioRepo.deactivateAllActive.mockResolvedValue([{ id: 13 }, { id: 14 }]);
            floodForecastRepo.setSlotManualOverride.mockResolvedValue({
                id: 11,
                status: 'MANUAL',
                is_manual_override: true,
                manual_rainfall: 0,
            });

            const result = await forecastScenarioService.applyManualOverride({
                hour: '06:00',
                date: '2026-09-19',
                rainfall: 0,
            });

            expect(result.success).toBe(true);
            expect(result.action).toBe('deactivated');
            expect(result.deactivatedCount).toBe(2);
            expect(result.scenario).toBeNull();
            expect(floodScenarioRepo.deactivateAllActive).toHaveBeenCalledTimes(1);
            expect(floodForecastRepo.setSlotManualOverride).toHaveBeenCalledWith({
                forecastDate: '2026-09-19',
                hourStr: '06:00',
                rainfall: 0,
                scenarioId: null,
            });
            expect(notificationEvents.notifyHydroScenarioTriggered).not.toHaveBeenCalled();
        });

        test('uses the Vietnam calendar date when date is omitted around UTC midnight', async () => {
            jest.useFakeTimers().setSystemTime(new Date('2026-09-18T18:30:00.000Z'));
            floodScenarioRepo.deactivateAllActive.mockResolvedValue([]);
            floodForecastRepo.setSlotManualOverride.mockResolvedValue({ id: 12 });

            try {
                await forecastScenarioService.applyManualOverride({
                    hour: '01:00',
                    rainfall: 0,
                });
            } finally {
                jest.useRealTimers();
            }

            expect(floodForecastRepo.setSlotManualOverride).toHaveBeenCalledWith({
                forecastDate: '2026-09-19',
                hourStr: '01:00',
                rainfall: 0,
                scenarioId: null,
            });
        });

        test('throws error if no matching scenario found', async () => {
            floodScenarioRepo.findById.mockResolvedValue(null);
            floodScenarioRepo.findMatchingScenario.mockResolvedValue(null);

            await expect(
                forecastScenarioService.applyManualOverride({
                    hour: '16:00',
                    rainfall: 5,
                }),
            ).rejects.toThrow('Không tìm thấy kịch bản ngập lụt hiện trạng phù hợp');
        });
    });

    describe('resetManualOverrideToAuto', () => {
        test('calls repository to reset slot to AUTO', async () => {
            floodForecastRepo.resetSlotToAuto.mockResolvedValue({
                id: 15,
                status: 'PENDING',
                is_manual_override: false,
            });

            const result = await forecastScenarioService.resetManualOverrideToAuto({
                hour: '14:00',
                date: '2026-09-18',
            });

            expect(result.success).toBe(true);
            expect(floodForecastRepo.resetSlotToAuto).toHaveBeenCalledWith({
                forecastDate: '2026-09-18',
                hourStr: '14:00',
            });
        });
    });

    describe('getForecastSchedule', () => {
        test('retrieves schedule for given date', async () => {
            const mockSchedule = [{ id: 1, hour_str: '00:00' }];
            floodForecastRepo.getScheduleByDate.mockResolvedValue(mockSchedule);

            const result = await forecastScenarioService.getForecastSchedule('2026-09-18');
            expect(result).toBe(mockSchedule);
            expect(floodForecastRepo.getScheduleByDate).toHaveBeenCalledWith('2026-09-18');
        });
    });
});
