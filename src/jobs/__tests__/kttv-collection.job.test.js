'use strict';

jest.mock('node-cron', () => ({ validate: jest.fn(), schedule: jest.fn() }));
jest.mock('../../repositories/kttv.repository');
jest.mock('../../services/kttv.service');
jest.mock('../../utils/systemLogger.util', () => ({
    logWarn: jest.fn(),
    logError: jest.fn(),
}));

const cron = require('node-cron');
const repository = require('../../repositories/kttv.repository');
const service = require('../../services/kttv.service');
const systemLogger = require('../../utils/systemLogger.util');
const job = require('../kttv-collection.job');

const task = () => ({ start: jest.fn(), stop: jest.fn() });

describe('kttv collection scheduler', () => {
    beforeEach(async () => {
        jest.clearAllMocks();
        await job.stop();
        cron.validate.mockReturnValue(true);
    });

    test('sync tạo task một lần và xóa task khi nguồn không còn lịch', async () => {
        const scheduled = task();
        cron.schedule.mockReturnValue(scheduled);
        repository.listScheduledSources.mockResolvedValue([{ id: '10', cron_expr: '*/5 * * * *' }]);

        await job.sync();
        await job.sync();
        expect(cron.schedule).toHaveBeenCalledTimes(1);

        repository.listScheduledSources.mockResolvedValue([]);
        await job.sync();
        expect(scheduled.stop).toHaveBeenCalledTimes(1);
    });

    test('cron sai bị bỏ qua và ghi cảnh báo', async () => {
        cron.validate.mockReturnValue(false);
        repository.listScheduledSources.mockResolvedValue([{ id: 11, cron_expr: 'bad' }]);
        await job.sync();
        expect(cron.schedule).not.toHaveBeenCalled();
        expect(systemLogger.logWarn).toHaveBeenCalledWith('kttv', 'kttv_source_invalid_cron', {
            sourceId: 11,
        });
    });

    test('runSource retry đúng số lần rồi thành công', async () => {
        jest.useFakeTimers();
        repository.findSource.mockResolvedValue({ retry_count: 2, retry_delay_sec: 1 });
        service.collectSource
            .mockRejectedValueOnce(new Error('first'))
            .mockRejectedValueOnce(new Error('second'))
            .mockResolvedValueOnce({ id: 1 });

        const running = job.runSource(10);
        await Promise.resolve();
        await jest.advanceTimersByTimeAsync(2000);
        await running;
        expect(service.collectSource).toHaveBeenCalledTimes(3);
        expect(systemLogger.logError).not.toHaveBeenCalled();
        jest.useRealTimers();
    });

    test('overlap guard coi bigint string và number là cùng nguồn', async () => {
        repository.findSource.mockResolvedValue({ retry_count: 0 });
        let release;
        service.collectSource.mockReturnValue(
            new Promise((resolve) => {
                release = resolve;
            }),
        );
        const first = job.runSource('10');
        await Promise.resolve();
        const second = job.runSource(10);
        expect(second).toBe(first);
        expect(service.collectSource).toHaveBeenCalledTimes(1);
        release();
        await Promise.all([first, second]);
    });

    test('stop chờ job đang chạy rồi mới hoàn tất', async () => {
        repository.findSource.mockResolvedValue({ retry_count: 0 });
        let release;
        service.collectSource.mockReturnValue(
            new Promise((resolve) => {
                release = resolve;
            }),
        );
        job.runSource(12);
        await Promise.resolve();
        let stopped = false;
        const stopping = job.stop().then(() => {
            stopped = true;
        });
        await Promise.resolve();
        expect(stopped).toBe(false);
        release();
        await stopping;
        expect(stopped).toBe(true);
    });
});
