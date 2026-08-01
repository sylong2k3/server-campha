jest.mock('../../repositories/systemLog.repository', () => ({
    findAll: jest.fn(),
    deleteOlderThan: jest.fn(),
}));

jest.mock('../../utils/activityLogger.util', () => ({
    logActivity: jest.fn(),
}));

const repository = require('../../repositories/systemLog.repository');
const activityLogger = require('../../utils/activityLogger.util');
const service = require('../systemLog.service');

describe('systemLog.service', () => {
    beforeEach(() => jest.clearAllMocks());

    test('trả danh sách và tổng số log', async () => {
        repository.findAll.mockResolvedValue({ items: [{ id: 1 }], total: 1 });
        await expect(service.listSystemLogs({ page: 1 })).resolves.toEqual({
            items: [{ id: 1 }],
            total: 1,
        });
    });

    test('cleanup ghi audit với actor và số bản ghi đã xóa', async () => {
        repository.deleteOlderThan.mockResolvedValue(7);
        activityLogger.logActivity.mockResolvedValue();
        const actor = {
            id: 3,
            lang: 'vi',
            ipAddress: '127.0.0.1',
            userAgent: 'jest',
        };

        const result = await service.cleanupSystemLogs(90, actor);

        expect(repository.deleteOlderThan).toHaveBeenCalledWith(90);
        expect(activityLogger.logActivity).toHaveBeenCalledWith('[SYSTEM LOG]', {
            userId: 3,
            action: 'system_logs_cleanup',
            ipAddress: '127.0.0.1',
            userAgent: 'jest',
            metadata: { olderThanDays: 90, deleted: 7 },
        });
        expect(result.deleted).toBe(7);
    });
});
