'use strict';

jest.mock('../../configs/database', () => ({
    query: jest.fn(),
    getClient: jest.fn(),
}));

const db = require('../../configs/database');
const repo = require('../flood-forecast.repository');

describe('flood-forecast.repository', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('saveForecastSnapshot inserts or updates snapshot', async () => {
        const mockRow = {
            id: 1,
            forecast_date: '2026-09-18',
            location: 'Cam Pha',
            hourly_data: [{ hour: '00:00', precipMm: 0 }],
        };
        db.query.mockResolvedValue({ rows: [mockRow] });

        const result = await repo.saveForecastSnapshot({
            forecastDate: '2026-09-18',
            location: 'Cam Pha',
            hourlyData: [{ hour: '00:00', precipMm: 0 }],
        });

        expect(result).toEqual(mockRow);
        expect(db.query).toHaveBeenCalledTimes(1);
        const [sql, params] = db.query.mock.calls[0];
        expect(sql).toContain('INSERT INTO gis.flood_forecast_snapshots');
        expect(sql).toContain('ON CONFLICT (forecast_date, location)');
        expect(params[0]).toBe('2026-09-18');
        expect(params[1]).toBe('Cam Pha');
    });

    test('createOrUpdateScheduleSlots inserts hourly slots', async () => {
        const hours = [
            { hour: '08:00', time: '2026-09-18 08:00', chanceOfRain: 60, precipMm: 25.5 },
            { hour: '09:00', time: '2026-09-18 09:00', chanceOfRain: 20, precipMm: 0 },
        ];
        db.query
            .mockResolvedValueOnce({ rows: [{ id: 10, hour_str: '08:00', status: 'PENDING' }] })
            .mockResolvedValueOnce({ rows: [{ id: 11, hour_str: '09:00', status: 'PENDING' }] });

        const results = await repo.createOrUpdateScheduleSlots(1, '2026-09-18', hours);

        expect(results).toHaveLength(2);
        expect(db.query).toHaveBeenCalledTimes(2);
        const [sql, params] = db.query.mock.calls[0];
        expect(sql).toContain('INSERT INTO gis.flood_forecast_schedule');
        expect(params[0]).toBe(1); // snapshot_id
        expect(params[1]).toBe('2026-09-18');
        expect(params[2]).toBe('08:00');
        expect(params[4]).toBe(60); // chance_of_rain
        expect(params[5]).toBe(25.5); // precip_mm
    });

    test('getDuePendingSlots queries pending slots due by targetTime', async () => {
        const now = new Date('2026-09-18T10:00:00Z');
        const mockRows = [{ id: 1, hour_str: '08:00' }, { id: 2, hour_str: '09:00' }];
        db.query.mockResolvedValue({ rows: mockRows });

        const slots = await repo.getDuePendingSlots(now);

        expect(slots).toEqual(mockRows);
        const [sql, params] = db.query.mock.calls[0];
        expect(sql).toContain("WHERE status = 'PENDING' AND is_manual_override = false AND scheduled_time <= $1");
        expect(params[0]).toBe(now);
    });

    test('updateScheduleSlot updates status and appliedScenarioId', async () => {
        const updatedRow = { id: 5, status: 'APPLIED', applied_scenario_id: 2 };
        db.query.mockResolvedValue({ rows: [updatedRow] });

        const res = await repo.updateScheduleSlot(5, { status: 'APPLIED', appliedScenarioId: 2 });

        expect(res).toEqual(updatedRow);
        const [sql, params] = db.query.mock.calls[0];
        expect(sql).toContain('UPDATE gis.flood_forecast_schedule');
        expect(params[0]).toBe('APPLIED');
        expect(params[1]).toBe(2);
        expect(params[2]).toBe(5);
    });

    test('setSlotManualOverride updates slot to MANUAL and sets is_manual_override', async () => {
        const mockRow = {
            id: 8,
            forecast_date: '2026-09-18',
            hour_str: '14:00',
            status: 'MANUAL',
            is_manual_override: true,
            manual_rainfall: 120,
            applied_scenario_id: 3,
        };
        db.query.mockResolvedValue({ rows: [mockRow] });

        const res = await repo.setSlotManualOverride({
            forecastDate: '2026-09-18',
            hourStr: '14:00',
            rainfall: 120,
            scenarioId: 3,
        });

        expect(res).toEqual(mockRow);
        const [sql, params] = db.query.mock.calls[0];
        expect(sql).toContain("SET status = 'MANUAL'");
        expect(sql).toContain('is_manual_override = true');
        expect(params[0]).toBe(120);
        expect(params[1]).toBe(3);
        expect(params[2]).toBe('2026-09-18');
        expect(params[3]).toBe('14:00');
    });

    test('resetSlotToAuto resets slot to PENDING and clears is_manual_override', async () => {
        const mockRow = {
            id: 8,
            forecast_date: '2026-09-18',
            hour_str: '14:00',
            status: 'PENDING',
            is_manual_override: false,
            manual_rainfall: null,
        };
        db.query.mockResolvedValue({ rows: [mockRow] });

        const res = await repo.resetSlotToAuto({
            forecastDate: '2026-09-18',
            hourStr: '14:00',
        });

        expect(res).toEqual(mockRow);
        const [sql, params] = db.query.mock.calls[0];
        expect(sql).toContain("SET status = 'PENDING'");
        expect(sql).toContain('is_manual_override = false');
        expect(params[0]).toBe('2026-09-18');
        expect(params[1]).toBe('14:00');
    });
});
