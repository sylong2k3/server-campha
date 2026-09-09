'use strict';

jest.mock('../websocket.server', () => ({ notifyChannel: jest.fn(), notifyUser: jest.fn() }));
jest.mock('../../repositories/field-report.repository');
jest.mock('../../services/notification.service');
const ws = require('../websocket.server'),
    repo = require('../../repositories/field-report.repository'),
    notificationService = require('../../services/notification.service'),
    listener = require('../field-report-listener');

describe('field report notification delivery', () => {
    beforeEach(() => jest.clearAllMocks());

    test('ignores malformed payload and sends status to sender plus manager roles', async () => {
        await listener.handle('{bad');
        expect(repo.eventSummary).not.toHaveBeenCalled();
        repo.eventSummary.mockResolvedValue({
            id: 3,
            reference_code: 'CP-3',
            sender_user_id: 7,
            status: 'approved',
            history_id: 44,
            actor_role: 'ubnd_tp',
            created_at: 'c',
            updated_at: 'u',
            description: 'secret',
            email: 'secret@x',
        });
        notificationService.notifyUsersAndRoles.mockResolvedValue({ recipientCount: 5 });

        await listener.handle(
            JSON.stringify({
                reportId: 3,
                event: 'status_changed',
                status: 'approved',
                previousStatus: 'under_review',
                actorUserId: 12,
            }),
        );

        expect(repo.eventSummary).toHaveBeenCalledWith(3, 12, 'approved', 'under_review');
        expect(ws.notifyChannel).toHaveBeenCalledTimes(4);
        const data = ws.notifyChannel.mock.calls[0][2];
        expect(data).not.toHaveProperty('description');
        expect(data).not.toHaveProperty('sender_user_id');
        expect(data.actorRole).toBe('ubnd_tp');
        expect(ws.notifyUser).toHaveBeenCalledWith(7, 'field_report', data);
        expect(notificationService.notifyUsersAndRoles).toHaveBeenCalledWith(
            [7],
            ['system_admin', 'ubnd_tp', 'so_tnmt', 'so_xd'],
            expect.objectContaining({
                body: 'Phản ánh CP-3: Đã phê duyệt',
                data: {
                    reportId: 3,
                    referenceCode: 'CP-3',
                    status: 'approved',
                    actorRole: 'ubnd_tp',
                },
                eventKey: 'field_report:3:history:44',
            }),
        );
    });

    test('broadcasts a created report once to all manager roles', async () => {
        repo.eventSummary.mockResolvedValue({
            id: 4,
            reference_code: 'CP-4',
            sender_user_id: 9,
            status: 'pending',
            created_at: 'c',
            updated_at: 'u',
        });
        notificationService.broadcastToRoles.mockResolvedValue({ recipientCount: 4 });

        await listener.handle(JSON.stringify({ reportId: 4, event: 'created', status: 'pending' }));

        expect(notificationService.broadcastToRoles).toHaveBeenCalledTimes(1);
        expect(notificationService.broadcastToRoles).toHaveBeenCalledWith(
            ['system_admin', 'ubnd_tp', 'so_tnmt', 'so_xd'],
            expect.objectContaining({
                data: {
                    reportId: 4,
                    referenceCode: 'CP-4',
                    status: 'pending',
                    actorRole: null,
                },
                eventKey: 'field_report:4:created',
            }),
        );
        expect(notificationService.notifyUsersAndRoles).not.toHaveBeenCalled();
    });
});
