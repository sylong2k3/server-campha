'use strict';

const { tick, startWorker, stopWorker, __resetForTests } = require('../rasterIngest.worker');

const silence = () => {
    const spies = {
        info: jest.spyOn(console, 'info').mockImplementation(() => {}),
        warn: jest.spyOn(console, 'warn').mockImplementation(() => {}),
        error: jest.spyOn(console, 'error').mockImplementation(() => {}),
        debug: jest.spyOn(console, 'debug').mockImplementation(() => {}),
    };
    return () => {
        for (const spy of Object.values(spies)) {
            spy.mockRestore();
        }
    };
};

describe('rasterIngest.worker', () => {
    let unsilence;
    beforeEach(() => {
        unsilence = silence();
        __resetForTests();
    });
    afterEach(() => {
        unsilence();
        stopWorker();
        __resetForTests();
    });

    test('tick returns { claimed: 0 } when the repo has nothing pending', async () => {
        const repo = { claimPending: jest.fn().mockResolvedValue([]) };
        const ingestSvc = { runJob: jest.fn() };
        const result = await tick({ repo, ingestSvc });
        expect(result).toEqual({ claimed: 0 });
        expect(ingestSvc.runJob).not.toHaveBeenCalled();
    });

    test('tick runs claimed jobs and reports how many succeeded', async () => {
        const repo = {
            claimPending: jest.fn().mockResolvedValue([{ id: 1 }, { id: 2 }, { id: 3 }]),
        };
        const ingestSvc = {
            runJob: jest
                .fn()
                .mockResolvedValueOnce(undefined)
                .mockRejectedValueOnce(new Error('boom'))
                .mockResolvedValueOnce(undefined),
        };
        const result = await tick({ repo, ingestSvc });
        expect(result).toEqual({ claimed: 3, ok: 2 });
        expect(ingestSvc.runJob).toHaveBeenCalledTimes(3);
    });

    test('tick skips overlapping calls (returns { skipped: true })', async () => {
        let releaseFirst;
        const repo = {
            claimPending: jest
                .fn()
                .mockImplementationOnce(
                    () =>
                        new Promise((resolve) => {
                            releaseFirst = () => resolve([]);
                        }),
                )
                .mockResolvedValue([]),
        };
        const ingestSvc = { runJob: jest.fn() };
        const first = tick({ repo, ingestSvc });
        const second = tick({ repo, ingestSvc });
        expect(await second).toEqual({ skipped: true });
        releaseFirst();
        expect(await first).toEqual({ claimed: 0 });
    });

    test('tick captures upstream errors instead of throwing', async () => {
        const repo = {
            claimPending: jest.fn().mockRejectedValue(new Error('DB down')),
        };
        const result = await tick({ repo, ingestSvc: { runJob: jest.fn() } });
        expect(result).toEqual({ error: 'DB down' });
    });

    test('tick gracefully skips when the repo module is not installed', async () => {
        const result = await tick({ repo: null, ingestSvc: null });
        expect(result).toEqual({ skipped: true });
    });

    test('startWorker returns DISABLED when RASTER_INGEST_ENABLED is false', () => {
        const previous = process.env.RASTER_INGEST_ENABLED;
        process.env.RASTER_INGEST_ENABLED = 'false';
        try {
            expect(startWorker()).toEqual({ started: false, reason: 'DISABLED' });
        } finally {
            if (previous === undefined) {
                delete process.env.RASTER_INGEST_ENABLED;
            } else {
                process.env.RASTER_INGEST_ENABLED = previous;
            }
        }
    });

    test('startWorker returns ALREADY_STARTED on the second call', () => {
        const previous = process.env.RASTER_INGEST_ENABLED;
        process.env.RASTER_INGEST_ENABLED = 'true';
        try {
            expect(startWorker()).toEqual({ started: true });
            expect(startWorker()).toEqual({ started: false, reason: 'ALREADY_STARTED' });
        } finally {
            stopWorker();
            if (previous === undefined) {
                delete process.env.RASTER_INGEST_ENABLED;
            } else {
                process.env.RASTER_INGEST_ENABLED = previous;
            }
        }
    });
});
