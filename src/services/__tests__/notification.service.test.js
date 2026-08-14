'use strict';
jest.mock('../../configs/database', () => ({ query: jest.fn() }));
jest.mock('../../repositories/device-token.repository');
jest.mock('../../repositories/user.repository');
jest.mock('../../repositories/notification.repository');
jest.mock('../../utils/pushProvider.util');
jest.mock('../../realtime/websocket.server', () => ({ notifyUser: jest.fn() }));
const db = require('../../configs/database'),
    deviceTokens = require('../../repositories/device-token.repository'),
    userRepository = require('../../repositories/user.repository'),
    notificationRepository = require('../../repositories/notification.repository'),
    pushProvider = require('../../utils/pushProvider.util'),
    websocket = require('../../realtime/websocket.server'),
    service = require('../notification.service');
describe('notification.service', () => {
    beforeEach(() => jest.clearAllMocks());

    describe('notifyUser', () => {
        test('persists the notification and skips push when FCM is disabled', async () => {
            pushProvider.isAvailable.mockReturnValue(false);
            notificationRepository.createMany.mockResolvedValue([
                { id: 10, user_id: 7, title: 't', body: 'b' },
            ]);
            const result = await service.notifyUser(7, { title: 't', body: 'b' });
            expect(notificationRepository.createMany).toHaveBeenCalledWith([7], {
                title: 't',
                body: 'b',
            });
            expect(websocket.notifyUser).toHaveBeenCalledWith(7, 'notification', {
                id: 10,
                user_id: 7,
                title: 't',
                body: 'b',
            });
            expect(result.disabled).toBe(true);
            expect(pushProvider.sendToTokens).not.toHaveBeenCalled();
        });
        test('pushes to the user active tokens and disables invalid ones', async () => {
            pushProvider.isAvailable.mockReturnValue(true);
            deviceTokens.activeForUser.mockResolvedValue(['tok1']);
            pushProvider.sendToTokens.mockResolvedValue({ invalidTokens: ['tok1'] });
            await service.notifyUser(7, { title: 't' });
            expect(pushProvider.sendToTokens).toHaveBeenCalledWith(['tok1'], { title: 't' });
            expect(deviceTokens.disableTokens).toHaveBeenCalledWith(['tok1']);
        });
    });

    describe('broadcastToRole', () => {
        test('rejects an invalid role code without touching the DB', async () => {
            await expect(service.broadcastToRole('Not Valid!', {})).rejects.toThrow(TypeError);
            expect(notificationRepository.createMany).not.toHaveBeenCalled();
        });
        test('persists one row per active user in the role, then pushes by role', async () => {
            userRepository.activeIdsByRoles.mockResolvedValue([1, 2]);
            notificationRepository.createMany.mockResolvedValue([
                { id: 11, user_id: 1, title: 'new report' },
                { id: 12, user_id: 2, title: 'new report' },
            ]);
            pushProvider.isAvailable.mockReturnValue(true);
            db.query.mockResolvedValue({ rows: [] });
            pushProvider.sendToTokens.mockResolvedValue({ invalidTokens: [] });
            const message = { title: 'new report' };
            await service.broadcastToRole('so_tnmt', message);
            expect(userRepository.activeIdsByRoles).toHaveBeenCalledWith(['so_tnmt']);
            expect(notificationRepository.createMany).toHaveBeenCalledWith([1, 2], message);
            expect(websocket.notifyUser).toHaveBeenCalledTimes(2);
            expect(websocket.notifyUser).toHaveBeenCalledWith(
                2,
                'notification',
                expect.objectContaining({ id: 12 }),
            );
        });
        test('skips DB persistence when the role has no active users', async () => {
            userRepository.activeIdsByRoles.mockResolvedValue([]);
            pushProvider.isAvailable.mockReturnValue(false);
            await service.broadcastToRole('so_xd', { title: 't' });
            expect(notificationRepository.createMany).not.toHaveBeenCalled();
        });
    });

    describe('listMine / unreadCount', () => {
        test('delegates straight to the repository scoped by userId', async () => {
            notificationRepository.listForUser.mockResolvedValue({ items: [], total: 0 });
            await service.listMine(7, { page: 1 });
            expect(notificationRepository.listForUser).toHaveBeenCalledWith(7, { page: 1 });

            notificationRepository.countUnread.mockResolvedValue(3);
            expect(await service.unreadCount(7)).toBe(3);
        });
    });

    describe('markRead', () => {
        test('throws 404 when the notification does not belong to the user', async () => {
            notificationRepository.markRead.mockResolvedValue(null);
            await expect(service.markRead(1, 7)).rejects.toMatchObject({ status: 404 });
        });
        test('returns the updated row on success', async () => {
            notificationRepository.markRead.mockResolvedValue({ id: 1, read_at: 'now' });
            expect(await service.markRead(1, 7)).toEqual({ id: 1, read_at: 'now' });
        });
    });

    describe('markAllRead', () => {
        test('returns the count of rows updated', async () => {
            notificationRepository.markAllRead.mockResolvedValue(5);
            expect(await service.markAllRead(7)).toEqual({ updated: 5 });
        });
    });

    describe('remove', () => {
        test('deletes only through the repository user scope', async () => {
            notificationRepository.remove.mockResolvedValue({ id: 3 });
            expect(await service.remove(3, 7)).toEqual({ id: 3 });
            expect(notificationRepository.remove).toHaveBeenCalledWith(3, 7);
        });

        test('throws 404 when the notification does not belong to the user', async () => {
            notificationRepository.remove.mockResolvedValue(null);
            await expect(service.remove(3, 7)).rejects.toMatchObject({ status: 404 });
        });
    });
});
