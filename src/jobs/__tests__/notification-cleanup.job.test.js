'use strict';

jest.mock('../../services/notification.service');
jest.mock('../../utils/systemLogger.util', () => ({
    logInfo: jest.fn(),
    logError: jest.fn(),
    logWarn: jest.fn(),
}));

const notificationService = require('../../services/notification.service');
const job = require('../notification-cleanup.job');

describe('notification-cleanup.job', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        job.stop();
    });

    afterEach(() => {
        job.stop();
    });

    test('runCleanup calls notificationService.cleanupOld and logs result', async () => {
        notificationService.cleanupOld.mockResolvedValue(12);
        const res = await job.runCleanup();
        expect(notificationService.cleanupOld).toHaveBeenCalledWith(90);
        expect(res).toEqual({ deletedCount: 12 });
    });

    test('runCleanup gracefully catches and logs errors', async () => {
        notificationService.cleanupOld.mockRejectedValue(new Error('DB connection lost'));
        const res = await job.runCleanup();
        expect(res).toEqual({ error: 'DB connection lost' });
    });

    test('start and stop work cleanly', () => {
        expect(() => {
            job.start();
            job.start(); // idempotent
            job.stop();
            job.stop();
        }).not.toThrow();
    });
});
