'use strict';

jest.mock('../notification.service');
jest.mock('../../repositories/flood-scenario.repository', () => ({
    classifyScenario: jest.fn(() => ({ type: 'hien_trang' })),
}));
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
            expect(message.data.floodPercentage).toBe(4.53);
            expect(message.data.channel).toBe('flood');
        });

        test('renders trend area and preserves warnings', async () => {
            const warnings = ['NON_COMMERCIAL_DTM_FABDEM'];
            await eventsService.notifyFloodRunCompleted({ id: '14', module: 'trend' }, {
                floodAreaHa: 665.4,
                floodPercentage: (665.4 / 33584) * 100,
                warnings,
            });

            const [, message] = notificationService.broadcastToRoles.mock.calls[0];
            expect(message.eventKey).toBe('flood_run:14:succeeded');
            expect(message.body).toContain('665.4 ha');
            expect(message.data.floodPercentage).toBeCloseTo(1.98, 2);
            expect(message.data.floodAreaHa).toBe(665.4);
            expect(message.data.warnings).toEqual(warnings);
        });

        test.each([null, undefined])('omits missing percentage (%s) without inventing zero', async (floodPercentage) => {
            await eventsService.notifyFloodRunCompleted({ id: '14', module: 'trend' }, {
                floodAreaHa: null,
                floodPercentage,
            });

            const [, message] = notificationService.broadcastToRoles.mock.calls[0];
            expect(message.body).toContain('Chưa có số liệu diện tích ngập');
            expect(message.body).not.toContain('%');
        });

        test('preserves zero area and percentage', async () => {
            await eventsService.notifyFloodRunCompleted({ id: '14', module: 'trend' }, {
                floodAreaHa: 0,
                floodPercentage: 0,
            });

            const [, message] = notificationService.broadcastToRoles.mock.calls[0];
            expect(message.body).toContain('0.0 ha');
            expect(message.data.floodPercentage).toBe(0);
            expect(message.data.floodAreaHa).toBe(0);
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
            const scenario = { id: 5, code: 'KB_05', name_vi: 'Kịch bản ngập mưa lớn 200mm', min_rainfall: 200, layer_code: 'layer_kb_05', type: 'hien_trang' };

            await eventsService.notifyHydroScenarioTriggered({
                scenario,
                rainVal: 220,
                tideVal: 1.8,
            });

            expect(notificationService.broadcastToRoles).toHaveBeenCalledTimes(1);
            const [, message] = notificationService.broadcastToRoles.mock.calls[0];
            expect(message.eventKey).toMatch(/^hydro_scenario:5:220:\d{4}-\d{2}-\d{2}T\d{2}$/);
            expect(message.type).toBe('hydro_scenario_triggered');
            expect(message.title).toBe('Cảnh báo kịch bản thủy văn:');
            expect(message.body).toBe('Cảnh báo có thể ngập mưa lớn 200mm\nDự báo lượng mưa: 220 mm/h');
            expect(message.data.channel).toBe('flood');
            expect(message.data.url).toBe('https://admincampha.tourismpj.pro.vn/kttv-scenarios');
        });

        test('skips notification when scenario type is cai_tao or quy_hoach', async () => {
            const caiTaoScenario = { id: 6, code: 'KB_CT', name_vi: 'Kịch bản tiêu thoát cải tạo', type: 'cai_tao' };
            const quyHoachScenario = { id: 7, code: 'KB_QH', name_vi: 'Kịch bản quy hoạch 2030', type: 'quy_hoach' };

            const resCaiTao = await eventsService.notifyHydroScenarioTriggered({ scenario: caiTaoScenario, rainVal: 100 });
            const resQuyHoach = await eventsService.notifyHydroScenarioTriggered({ scenario: quyHoachScenario, rainVal: 100 });

            expect(resCaiTao).toBeNull();
            expect(resQuyHoach).toBeNull();
            expect(notificationService.broadcastToRoles).not.toHaveBeenCalled();
        });
    });

    describe('notifyHydroScenarioUpdated', () => {
        test('does not dispatch notification on parameter updates (activation-only policy)', async () => {
            const scenario = { id: 5, code: 'KB_05', name_vi: 'Kịch bản ngập úng trung tâm', min_rainfall: 150, max_rainfall: 250, type: 'hien_trang' };

            const res = await eventsService.notifyHydroScenarioUpdated(scenario);

            expect(res).toBeNull();
            expect(notificationService.broadcastToRoles).not.toHaveBeenCalled();
        });
    });

    describe('missing and malformed metrics', () => {
        const invalid = [null, undefined, '', '   ', 'invalid', NaN, Infinity, -Infinity, -1, false, [], {}];
        test.each(invalid)('does not render invalid metric %p as data', async (value) => {
            await eventsService.notifyForestSnapshotCompleted({ id: 1, year: 2026, month: 9 }, {
                coverage: { forestHa: value, forestPercent: value, mineHa: value, minePercent: value },
            });
            await eventsService.notifyFloodRunCompleted({ id: 14, module: 'trend' }, {
                floodAreaHa: value, floodPercentage: value,
            });
            await eventsService.notifyHydroScenarioTriggered({
                scenario: { id: 5, type: 'hien_trang', name_vi: 'Kịch bản ngập nhẹ' }, rainVal: value,
            });
            for (const [, message] of notificationService.broadcastToRoles.mock.calls) {
                expect(message.body).not.toMatch(/N\/A|NaN|Infinity|undefined|\bnull\b/);
                expect(message.body.toLowerCase()).toContain('chưa có số liệu');
                expect(message.body).not.toMatch(/0(?:\.0+)? (ha|mm\/h)|0(?:\.0+)?%/);
            }
            const hydro = notificationService.broadcastToRoles.mock.calls[2][1];
            expect(hydro.eventKey).toContain(':unknown:');
            expect(hydro.data.rainfall).toBeNull();
        });

        test('accepts numeric strings and keeps real zero rainfall and coverage', async () => {
            await eventsService.notifyForestSnapshotCompleted({ id: 1, year: 2026, month: 9 }, {
                coverage: { forestHa: '0', forestPercent: '0', mineHa: '12.5', minePercent: '1.25' },
            });
            await eventsService.notifyHydroScenarioTriggered({
                scenario: { id: 5, type: 'hien_trang' }, rainVal: 0,
            });
            const forest = notificationService.broadcastToRoles.mock.calls[0][1];
            const hydro = notificationService.broadcastToRoles.mock.calls[1][1];
            expect(forest.body).toContain('0.00% (0.0 ha)');
            expect(forest.body).toContain('1.25% (12.5 ha)');
            expect(hydro.body).toContain('0 mm/h');
            expect(hydro.eventKey).toContain(':0:');
        });

        test('renders partial forest statistics without invented area or percent', async () => {
            await eventsService.notifyForestSnapshotCompleted({ id: 1, year: 2026, month: 9 }, {
                coverage: { forestHa: 123.4, minePercent: 2.5 },
            });
            const [, message] = notificationService.broadcastToRoles.mock.calls[0];
            expect(message.body).toContain('123.4 ha');
            expect(message.body).toContain('2.50%');
            expect(message.body).not.toMatch(/N\/A|undefined|null|NaN/);
        });

        test('failure notifications use meaningful defaults when no error is supplied', async () => {
            await eventsService.notifyForestSnapshotFailed({ id: 1, year: 2026, month: 9 });
            await eventsService.notifyFloodRunFailed({ id: 14, module: 'trend' });
            expect(notificationService.broadcastToRoles.mock.calls[0][1].body).toContain('Lỗi không xác định');
            expect(notificationService.broadcastToRoles.mock.calls[1][1].body).toContain('Lỗi xử lý');
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
