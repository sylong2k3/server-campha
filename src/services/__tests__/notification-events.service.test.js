'use strict';

jest.mock('../notification.service');
jest.mock('../../utils/systemLogger.util', () => ({
    logInfo: jest.fn(),
    logError: jest.fn(),
    logWarn: jest.fn(),
    logDebug: jest.fn(),
}));
const notificationService = require('../notification.service');
const eventsService = require('../notification-events.service');

describe('notification-events.service', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        notificationService.broadcastToRoles.mockResolvedValue({
            recipientCount: 4,
            successCount: 4,
            duplicate: false,
        });
    });

    describe('notifyForestSnapshotCompleted', () => {
        test('dispatches completed notification to MANAGER_ROLES with % and ha', async () => {
            const snapshot = { id: 10, year: 2026, month: 9 };
            const seasonContext = { label: 'Báo cáo toàn mùa Thu năm 2026' };
            const coverage = { forestPercent: 65.4, forestHa: 21950.2, minePercent: 8.3, mineHa: 2780.5 };

            await eventsService.notifyForestSnapshotCompleted(snapshot, { seasonContext, coverage });

            expect(notificationService.broadcastToRoles).toHaveBeenCalledTimes(1);
            const [roles, message] = notificationService.broadcastToRoles.mock.calls[0];
            expect(roles).toEqual(['system_admin', 'ubnd_tp', 'so_tnmt', 'so_xd']);
            expect(message.eventKey).toBe('forest:2026-09:completed');
            expect(message.type).toBe('forest_snapshot_completed');
            expect(message.title).toContain('Báo cáo toàn mùa Thu năm 2026');
            expect(message.body).toContain('65.40%');
            expect(message.body).toContain('21950.2 ha');
            expect(message.body).toContain('8.30%');
            expect(message.data.channel).toBe('forest');
        });
    });

    describe('notifyForestSnapshotFailed', () => {
        test('dispatches failure notification with attempt number and error', async () => {
            const snapshot = { id: 10, year: 2026, month: 10, attempt: 2 };
            const seasonContext = { label: 'Kết quả tháng 10 thuộc mùa Đông năm 2026' };
            const error = new Error('Asset 404');

            await eventsService.notifyForestSnapshotFailed(snapshot, { seasonContext, error });

            expect(notificationService.broadcastToRoles).toHaveBeenCalledTimes(1);
            const [, message] = notificationService.broadcastToRoles.mock.calls[0];
            expect(message.eventKey).toBe('forest:2026-10:failed:2');
            expect(message.type).toBe('forest_snapshot_failed');
            expect(message.body).toContain('lần thử 2');
            expect(message.body).toContain('Asset 404');
        });
    });

    describe('notifyFloodRunCompleted', () => {
        test('dispatches flood run succeeded with area and percentage', async () => {
            const run = { id: 128, module: 'event' };
            await eventsService.notifyFloodRunCompleted(run, {
                floodAreaHa: 1520.5,
                floodPercentage: 4.53,
                warnings: [],
            });

            expect(notificationService.broadcastToRoles).toHaveBeenCalledTimes(1);
            const [roles, message] = notificationService.broadcastToRoles.mock.calls[0];
            expect(roles).toEqual(['system_admin', 'ubnd_tp', 'so_tnmt', 'so_xd']);
            expect(message.eventKey).toBe('flood_run:128:succeeded');
            expect(message.type).toBe('flood_run_succeeded');
            expect(message.body).toContain('1520.5 ha');
            expect(message.body).toContain('4.53%');
            expect(message.data.channel).toBe('flood');
        });
    });

    describe('notifyFloodRunFailed', () => {
        test('dispatches flood run failed with attempt and error code', async () => {
            const run = { id: 128, module: 'event', attempt_no: 1 };
            const error = new Error('No SAR scenes found');

            await eventsService.notifyFloodRunFailed(run, error);

            expect(notificationService.broadcastToRoles).toHaveBeenCalledTimes(1);
            const [, message] = notificationService.broadcastToRoles.mock.calls[0];
            expect(message.eventKey).toBe('flood_run:128:failed:1');
            expect(message.type).toBe('flood_run_failed');
            expect(message.body).toContain('No SAR scenes found');
            expect(message.data.channel).toBe('flood');
        });
    });

    describe('notifyHydroScenarioTriggered', () => {
        test('dispatches hydro scenario trigger notification with rainfall threshold', async () => {
            const scenario = { id: 5, code: 'KB_05', name_vi: 'Kịch bản ngập mưa lớn 200mm', min_rainfall: 200, layer_code: 'layer_kb_05' };

            await eventsService.notifyHydroScenarioTriggered({
                scenario,
                rainVal: 220,
                tideVal: 1.8,
            });

            expect(notificationService.broadcastToRoles).toHaveBeenCalledTimes(1);
            const [, message] = notificationService.broadcastToRoles.mock.calls[0];
            expect(message.eventKey).toMatch(/^hydro_scenario:5:220:\d{4}-\d{2}-\d{2}T\d{2}$/);
            expect(message.type).toBe('hydro_scenario_triggered');
            expect(message.title).toContain('Kịch bản ngập mưa lớn 200mm');
            expect(message.body).toContain('220 mm');
            expect(message.body).toContain('200 mm');
            expect(message.data.channel).toBe('flood');
        });
    });

    describe('notifyHydroScenarioUpdated', () => {
        test('dispatches hydro scenario updated notification', async () => {
            const scenario = { id: 5, code: 'KB_05', name_vi: 'Kịch bản ngập úng trung tâm', min_rainfall: 150, max_rainfall: 250 };

            await eventsService.notifyHydroScenarioUpdated(scenario);

            expect(notificationService.broadcastToRoles).toHaveBeenCalledTimes(1);
            const [, message] = notificationService.broadcastToRoles.mock.calls[0];
            expect(message.eventKey).toMatch(/^hydro_scenario:5:updated:\d+$/);
            expect(message.type).toBe('hydro_scenario_updated');
            expect(message.body).toContain('150 - 250 mm');
        });
    });

    describe('deduplication safety', () => {
        test('duplicate dispatch returns duplicate result from notification service', async () => {
            notificationService.broadcastToRoles.mockResolvedValueOnce({
                recipientCount: 0,
                duplicate: true,
            });

            const result = await eventsService.notifyFloodRunCompleted({ id: 128, module: 'event' }, {});
            expect(result.duplicate).toBe(true);
            expect(result.recipientCount).toBe(0);
        });
    });
});
