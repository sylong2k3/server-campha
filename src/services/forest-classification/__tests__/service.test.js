'use strict';

const { executeRun, requestRun } = require('../service');
const { CAM_PHA_GEOMETRY } = require('../../satellite/geometry');

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
        const notificationEvents = {
            notifyForestSnapshotCompleted: jest.fn().mockResolvedValue({}),
            notifyForestSnapshotFailed: jest.fn().mockResolvedValue({}),
        };

        await executeRun(snapshot, { repository, satellite, queueArchive, notificationEvents });

        expect(notificationEvents.notifyForestSnapshotCompleted).toHaveBeenCalledTimes(1);

        expect(satellite.getClassified).toHaveBeenCalledWith(
            expect.objectContaining({ geometry: CAM_PHA_GEOMETRY }),
        );
        expect(queueArchive).toHaveBeenCalledWith(
            snapshot,
            expect.objectContaining({ downloadUrl: 'https://gee/tif' }),
        );
        expect(repository.updateRun).toHaveBeenLastCalledWith(
            9,
            expect.objectContaining({
                status: 'exporting',
                provinceSummary: expect.objectContaining({
                    rasterIngestJobId: 22,
                    classSchema: 'campha_landcover_8',
                }),
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
        const notificationEvents = {
            notifyForestSnapshotCompleted: jest.fn().mockResolvedValue({}),
            notifyForestSnapshotFailed: jest.fn().mockResolvedValue({}),
        };

        await executeRun(snapshot, { repository, satellite, queueArchive, notificationEvents });

        expect(notificationEvents.notifyForestSnapshotCompleted).toHaveBeenCalledTimes(1);

        expect(repository.updateRun).toHaveBeenLastCalledWith(
            9,
            expect.objectContaining({ status: 'completed' }),
        );
    });

    test.each([
        ['missing stats', {}, { forestPercent: null, minePercent: null }],
        ['empty stats without total', { areaByClass: {} }, { forestPercent: null, minePercent: null }],
        ['zero classified area', { areaByClass: {}, totalHa: 0 }, { forestHa: 0, mineHa: 0, forestPercent: null, minePercent: null }],
        ['missing total', { areaByClass: { 1: 20, 4: 5 } }, { forestHa: 20, mineHa: 5, forestPercent: null, minePercent: null }],
        ['valid stats', { areaByClass: { 1: 20, 4: 5 }, totalHa: 100 }, { forestHa: 20, mineHa: 5, forestPercent: 20, minePercent: 5 }],
        ['real zero class', { areaByClass: { 1: 0, 4: 0 }, totalHa: 100 }, { forestHa: 0, mineHa: 0, forestPercent: 0, minePercent: 0 }],
        ['malformed stats', { areaByClass: { 1: 'invalid' }, totalHa: 100 }, {}],
    ])('passes honest notification coverage for %s', async (_label, stats, coverage) => {
        const notificationEvents = {
            notifyForestSnapshotCompleted: jest.fn(), notifyForestSnapshotFailed: jest.fn(),
        };
        await executeRun(snapshot, {
            repository: { updateRun: jest.fn().mockResolvedValue(snapshot) },
            satellite: { getClassified: jest.fn().mockResolvedValue({ stats }) },
            queueArchive: jest.fn().mockResolvedValue(null),
            notificationEvents,
        });
        expect(notificationEvents.notifyForestSnapshotCompleted).toHaveBeenCalledWith(
            snapshot, expect.objectContaining({ coverage }),
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
