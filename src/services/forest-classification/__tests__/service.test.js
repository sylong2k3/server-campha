'use strict';

const { executeRun, requestRun } = require('../service');

const snapshot = { id: 9, year: 2026, month: 7 };

describe('forest-classification service', () => {
    test('queues the completed GEE GeoTIFF for archive and marks the snapshot exporting', async () => {
        const repository = {
            updateRun: jest.fn().mockResolvedValue({ ...snapshot, status: 'exporting' }),
        };
        const satellite = {
            getClassified: jest.fn().mockResolvedValue({
                geeTileUrl: 'tiles',
                downloadUrl: 'https://gee/tif',
                stats: {},
            }),
        };
        const queueArchive = jest.fn().mockResolvedValue({ job: { id: 22 } });

        await executeRun(snapshot, { repository, satellite, queueArchive });

        expect(queueArchive).toHaveBeenCalledWith(
            snapshot,
            expect.objectContaining({ downloadUrl: 'https://gee/tif' }),
        );
        expect(repository.updateRun).toHaveBeenLastCalledWith(
            9,
            expect.objectContaining({
                status: 'exporting',
                provinceSummary: expect.objectContaining({ rasterIngestJobId: 22 }),
            }),
        );
    });

    test('keeps an interactive result completed when archive enqueue is disabled', async () => {
        const repository = {
            updateRun: jest.fn().mockResolvedValue({ ...snapshot, status: 'completed' }),
        };
        const satellite = {
            getClassified: jest
                .fn()
                .mockResolvedValue({ geeTileUrl: 'tiles', downloadUrl: null, stats: {} }),
        };
        const queueArchive = jest.fn().mockResolvedValue(null);

        await executeRun(snapshot, { repository, satellite, queueArchive });

        expect(repository.updateRun).toHaveBeenLastCalledWith(
            9,
            expect.objectContaining({ status: 'completed' }),
        );
    });

    test('enqueues a durable, per-period GEE task once', async () => {
        const repository = {
            createRun: jest.fn().mockResolvedValue({ snapshot, deduplicated: false }),
        };
        const queue = { enqueue: jest.fn().mockResolvedValue(undefined) };

        const result = await requestRun(
            { year: 2026, month: 7, trigger: 'cron', requestedBy: null },
            { repository, queue },
        );

        expect(result.taskKey).toBe('analysis:forest-classification:2026-07');
        expect(queue.enqueue).toHaveBeenCalledWith(
            expect.objectContaining({ key: result.taskKey }),
        );
    });
});
