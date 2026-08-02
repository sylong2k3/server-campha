'use strict';
jest.mock('../websocket.server', () => ({ notifyChannel: jest.fn(), notifyUser: jest.fn() }));
jest.mock('../../repositories/field-report.repository');
jest.mock('../../repositories/device-token.repository');
jest.mock('../../utils/pushProvider.util');
const ws = require('../websocket.server'),
    repo = require('../../repositories/field-report.repository'),
    tokens = require('../../repositories/device-token.repository'),
    push = require('../../utils/pushProvider.util'),
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
        tokens.activeForUser.mockResolvedValue([]);
        push.sendToTokens.mockResolvedValue({ invalidTokens: [] });
        await listener.handle(JSON.stringify({ reportId: 3, event: 'status_changed' }));
        expect(ws.notifyChannel).toHaveBeenCalledTimes(3);
        const data = ws.notifyChannel.mock.calls[0][2];
        expect(data).not.toHaveProperty('description');
        expect(data).not.toHaveProperty('sender_user_id');
        expect(ws.notifyUser).toHaveBeenCalledWith(7, 'field_report', data);
    });
});
