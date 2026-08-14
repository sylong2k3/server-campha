'use strict';
jest.mock('../websocket.server', () => ({ notifyChannel: jest.fn(), notifyUser: jest.fn() }));
jest.mock('../../repositories/field-report.repository');
jest.mock('../../services/notification.service');
const ws = require('../websocket.server'),
    repo = require('../../repositories/field-report.repository'),
    notificationService = require('../../services/notification.service'),
    listener = require('../field-report-listener');
describe('Sprint 8 realtime privacy', () => {
    beforeEach(() => jest.clearAllMocks());
    test('ignores malformed payload and sends sanitized role/user event', async () => {
        await listener.handle('{bad');
        expect(repo.eventSummary).not.toHaveBeenCalled();
        repo.eventSummary.mockResolvedValue({
            id: 3,
            reference_code: 'CP-3',
            sender_user_id: 7,
            status: 'approved',
            created_at: 'c',
            updated_at: 'u',
            description: 'secret',
            email: 'secret@x',
        });
        notificationService.notifyUser.mockResolvedValue({ invalidTokens: [] });
        await listener.handle(JSON.stringify({ reportId: 3, event: 'status_changed' }));
        expect(ws.notifyChannel).toHaveBeenCalledTimes(3);
        const data = ws.notifyChannel.mock.calls[0][2];
        expect(data).not.toHaveProperty('description');
        expect(data).not.toHaveProperty('sender_user_id');
        expect(ws.notifyUser).toHaveBeenCalledWith(7, 'field_report', data);
        expect(notificationService.notifyUser).toHaveBeenCalledWith(
            7,
            expect.objectContaining({ data: { reportId: 3, status: 'approved' } }),
        );
        expect(notificationService.broadcastToRole).not.toHaveBeenCalled();
    });
    test('broadcasts push to manager roles when a report is created', async () => {
        repo.eventSummary.mockResolvedValue({
            id: 4,
            reference_code: 'CP-4',
            sender_user_id: 9,
            status: 'pending',
            created_at: 'c',
            updated_at: 'u',
        });
        notificationService.broadcastToRole.mockResolvedValue({
            successCount: 1,
            failureCount: 0,
            invalidTokens: [],
        });
        await listener.handle(JSON.stringify({ reportId: 4, event: 'created' }));
        expect(notificationService.broadcastToRole).toHaveBeenCalledTimes(3);
        expect(notificationService.broadcastToRole).toHaveBeenCalledWith(
            'ubnd_tp',
            expect.objectContaining({ data: { reportId: 4, status: 'pending' } }),
        );
        expect(notificationService.broadcastToRole).toHaveBeenCalledWith(
            'so_tnmt',
            expect.anything(),
        );
        expect(notificationService.broadcastToRole).toHaveBeenCalledWith('so_xd', expect.anything());
        expect(notificationService.notifyUser).not.toHaveBeenCalled();
    });
});
