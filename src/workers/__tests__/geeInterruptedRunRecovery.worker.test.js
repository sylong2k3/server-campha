'use strict';

const { recoverInterruptedRuns } = require('../geeInterruptedRunRecovery.worker');

describe('geeInterruptedRunRecovery.worker', () => {
    let logSpies;

    beforeEach(() => {
        logSpies = {
            info: jest.spyOn(console, 'info').mockImplementation(() => {}),
            warn: jest.spyOn(console, 'warn').mockImplementation(() => {}),
            error: jest.spyOn(console, 'error').mockImplementation(() => {}),
        };
    });

    afterEach(() => {
        for (const spy of Object.values(logSpies)) {
            spy.mockRestore();
        }
    });

    test('returns zero counts and logs an info when the flood repo is not installed', async () => {
        const result = await recoverInterruptedRuns({
            repoLoader: () => ({
                floodRepo: null,
                ingestRepo: null,
                floodRepoLoadError: { code: 'MODULE_NOT_FOUND' },
            }),
        });
        expect(result).toEqual({ runs: 0, ingestJobs: 0, forestSnapshots: 0 });
        expect(logSpies.info).toHaveBeenCalledWith(
            expect.stringContaining('flood_analysis_run repository not present yet'),
        );
    });

    test('returns aggregated counts when both repos are present and healthy', async () => {
        const floodRepo = {
            failInterruptedActiveRuns: jest.fn().mockResolvedValue([
                { id: 1, module: 'event' },
                { id: 2, module: 'hand' },
            ]),
        };
        const ingestRepo = {
            recoverInterruptedJobs: jest.fn().mockResolvedValue(3),
        };
        const result = await recoverInterruptedRuns({
            repoLoader: () => ({ floodRepo, ingestRepo, floodRepoLoadError: null }),
        });
        expect(result).toEqual({ runs: 2, ingestJobs: 3, forestSnapshots: 0 });
        expect(floodRepo.failInterruptedActiveRuns).toHaveBeenCalledWith({
            errorCode: 'INTERRUPTED_ON_RESTART',
        });
        expect(ingestRepo.recoverInterruptedJobs).toHaveBeenCalledWith({
            errorCode: 'INTERRUPTED_ON_RESTART',
        });
        expect(logSpies.warn).toHaveBeenCalled();
    });

    test('handles ingest repo being missing (only run recovery runs)', async () => {
        const floodRepo = {
            failInterruptedActiveRuns: jest.fn().mockResolvedValue([{ id: 1 }]),
        };
        const result = await recoverInterruptedRuns({
            repoLoader: () => ({ floodRepo, ingestRepo: null, floodRepoLoadError: null }),
        });
        expect(result).toEqual({ runs: 1, ingestJobs: 0, forestSnapshots: 0 });
    });

    test('logs an error but does not throw when the flood repo throws', async () => {
        const floodRepo = {
            failInterruptedActiveRuns: jest.fn().mockRejectedValue(new Error('DB unreachable')),
        };
        const result = await recoverInterruptedRuns({
            repoLoader: () => ({ floodRepo, ingestRepo: null, floodRepoLoadError: null }),
        });
        expect(result).toEqual({ runs: 0, ingestJobs: 0, forestSnapshots: 0 });
        expect(logSpies.error).toHaveBeenCalledWith(
            expect.stringContaining('failInterruptedActiveRuns error: DB unreachable'),
        );
    });

    test('logs an error but does not throw when the ingest repo throws', async () => {
        const floodRepo = {
            failInterruptedActiveRuns: jest.fn().mockResolvedValue([{ id: 5 }]),
        };
        const ingestRepo = {
            recoverInterruptedJobs: jest.fn().mockRejectedValue(new Error('MinIO offline')),
        };
        const result = await recoverInterruptedRuns({
            repoLoader: () => ({ floodRepo, ingestRepo, floodRepoLoadError: null }),
        });
        expect(result).toEqual({ runs: 1, ingestJobs: 0, forestSnapshots: 0 });
        expect(logSpies.error).toHaveBeenCalledWith(
            expect.stringContaining('recoverInterruptedJobs error: MinIO offline'),
        );
    });

    test('returns zero counts and logs an info line when everything is clean', async () => {
        const floodRepo = {
            failInterruptedActiveRuns: jest.fn().mockResolvedValue([]),
        };
        const ingestRepo = {
            recoverInterruptedJobs: jest.fn().mockResolvedValue(0),
        };
        const result = await recoverInterruptedRuns({
            repoLoader: () => ({ floodRepo, ingestRepo, floodRepoLoadError: null }),
        });
        expect(result).toEqual({ runs: 0, ingestJobs: 0, forestSnapshots: 0 });
        expect(logSpies.info).toHaveBeenCalledWith(
            expect.stringContaining('No interrupted flood, forest, or ingest jobs found'),
        );
    });

    test('marks orphaned forest compute snapshots failed so a period can run again', async () => {
        const forestRepo = {
            listActiveRuns: jest.fn().mockResolvedValue([
                { id: 13, status: 'computing' },
                { id: 14, status: 'pending' },
            ]),
            updateRun: jest.fn().mockResolvedValue(undefined),
        };

        const result = await recoverInterruptedRuns({
            repoLoader: () => ({ floodRepo: null, ingestRepo: null, forestRepo }),
        });

        expect(result).toEqual({ runs: 0, ingestJobs: 0, forestSnapshots: 2 });
        expect(forestRepo.updateRun).toHaveBeenCalledTimes(2);
        expect(forestRepo.updateRun).toHaveBeenCalledWith(
            13,
            expect.objectContaining({ status: 'failed' }),
        );
    });

    test('keeps an exporting forest snapshot while its ingest job is still active', async () => {
        const forestRepo = {
            listActiveRuns: jest.fn().mockResolvedValue([
                {
                    id: 13,
                    status: 'exporting',
                    province_summary: { rasterIngestJobId: 22 },
                },
            ]),
            updateRun: jest.fn(),
        };
        const ingestRepo = {
            recoverInterruptedJobs: jest.fn().mockResolvedValue(0),
            findById: jest.fn().mockResolvedValue({ id: 22, status: 'pending' }),
        };

        const result = await recoverInterruptedRuns({
            repoLoader: () => ({ floodRepo: null, ingestRepo, forestRepo }),
        });

        expect(result).toEqual({ runs: 0, ingestJobs: 0, forestSnapshots: 0 });
        expect(forestRepo.updateRun).not.toHaveBeenCalled();
    });

    test('reconciles an exporting forest snapshot whose ingest job already completed', async () => {
        const forestRepo = {
            listActiveRuns: jest.fn().mockResolvedValue([
                {
                    id: 13,
                    status: 'exporting',
                    province_summary: { rasterIngestJobId: 22 },
                },
            ]),
            updateRun: jest.fn(),
        };
        const ingestRepo = {
            recoverInterruptedJobs: jest.fn().mockResolvedValue(0),
            findById: jest.fn().mockResolvedValue({
                id: 22,
                status: 'completed',
                geoserver_layer: 'campha:forest_classification_202607',
                geoserver_store: 'forest_classification_202607',
                minio_category: 'raster',
                minio_key: 'raster/2026/07/latest.tif',
            }),
        };
        const rasterPublisher = {
            backLinkResource: jest.fn().mockResolvedValue({ rowCount: 1 }),
        };

        const result = await recoverInterruptedRuns({
            repoLoader: () => ({
                floodRepo: null,
                ingestRepo,
                forestRepo,
                rasterPublisher,
            }),
        });

        expect(result).toEqual({ runs: 0, ingestJobs: 0, forestSnapshots: 1 });
        expect(rasterPublisher.backLinkResource).toHaveBeenCalledWith(
            { type: 'forest_snapshot', id: 13 },
            expect.objectContaining({
                geoserverLayer: 'campha:forest_classification_202607',
                minioKey: 'raster/2026/07/latest.tif',
            }),
        );
        expect(forestRepo.updateRun).not.toHaveBeenCalled();
    });

    test('fails an exporting forest snapshot when its linked ingest job is terminal', async () => {
        const forestRepo = {
            listActiveRuns: jest.fn().mockResolvedValue([
                {
                    id: 13,
                    status: 'exporting',
                    province_summary: { rasterIngestJobId: 22 },
                },
            ]),
            updateRun: jest.fn().mockResolvedValue(undefined),
        };
        const ingestRepo = {
            recoverInterruptedJobs: jest.fn().mockResolvedValue(0),
            findById: jest.fn().mockResolvedValue({ id: 22, status: 'dlq' }),
        };

        const result = await recoverInterruptedRuns({
            repoLoader: () => ({ floodRepo: null, ingestRepo, forestRepo }),
        });

        expect(result).toEqual({ runs: 0, ingestJobs: 0, forestSnapshots: 1 });
        expect(forestRepo.updateRun).toHaveBeenCalledWith(
            13,
            expect.objectContaining({
                status: 'failed',
                errorMessage: expect.stringContaining('dlq'),
            }),
        );
    });
});
