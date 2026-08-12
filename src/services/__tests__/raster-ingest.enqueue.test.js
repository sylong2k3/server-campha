'use strict';

const { enqueue, safeUrl } = require('../raster-ingest.enqueue');
const { Api400Error, Api503Error } = require('../../core/error.response');

// enqueue calls cfg.isEnabled() at call time, so we can toggle the env var
// per test without any module reload / class-identity issues.
const withRasterIngestEnabled = async (fn) => {
    const previous = process.env.RASTER_INGEST_ENABLED;
    process.env.RASTER_INGEST_ENABLED = 'true';
    try {
        return await fn({ enqueue });
    } finally {
        if (previous === undefined) {
            delete process.env.RASTER_INGEST_ENABLED;
        } else {
            process.env.RASTER_INGEST_ENABLED = previous;
        }
    }
};

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

const makeClient = () => {
    const client = {
        query: jest.fn().mockResolvedValue(undefined),
        release: jest.fn(),
    };
    return client;
};

const makeDb = () => {
    const client = makeClient();
    const db = {
        pool: {
            connect: jest.fn().mockResolvedValue(client),
        },
        __client: client,
    };
    return db;
};

const makeRepo = (overrides = {}) => ({
    findActiveBySourceHash: jest.fn().mockResolvedValue(null),
    findActiveByLayerCode: jest.fn().mockResolvedValue(null),
    insertJob: jest.fn().mockResolvedValue({ id: 42, status: 'pending' }),
    ...overrides,
});

describe('safeUrl', () => {
    test('strips query string and truncates the path', () => {
        expect(safeUrl('https://example.com/deep/path/segment?token=SECRET&x=1')).toBe(
            'https://example.com/deep/path/segment…',
        );
    });
    test('returns "" for empty input and a truncation for invalid URLs', () => {
        expect(safeUrl('')).toBe('');
        expect(safeUrl('not-a-url')).toBe('not-a-url…');
    });
});

describe('enqueue()', () => {
    let unsilence;
    beforeEach(() => {
        unsilence = silence();
    });
    afterEach(() => {
        unsilence();
    });

    test('throws Api503Error when RASTER_INGEST_ENABLED=false (default)', async () => {
        await expect(
            enqueue(
                { sourceUrl: 'https://x.example/y', layerCode: 'cp_flood_event' },
                { db: makeDb(), repo: makeRepo() },
            ),
        ).rejects.toBeInstanceOf(Api503Error);
    });

    test('throws Api400Error for invalid layer code', async () => {
        await withRasterIngestEnabled(async ({ enqueue: fresh }) => {
            await expect(
                fresh(
                    { sourceUrl: 'https://x.example/y', layerCode: '9no-good' },
                    { db: makeDb(), repo: makeRepo() },
                ),
            ).rejects.toBeInstanceOf(Api400Error);
        });
    });

    test('throws Api400Error for non-http source URL', async () => {
        await withRasterIngestEnabled(async ({ enqueue: fresh }) => {
            await expect(
                fresh(
                    { sourceUrl: 'ftp://ex/y', layerCode: 'cp_flood_event' },
                    { db: makeDb(), repo: makeRepo() },
                ),
            ).rejects.toBeInstanceOf(Api400Error);
        });
    });

    test('dedupes on source hash without touching the DB when a job is already active', async () => {
        await withRasterIngestEnabled(async ({ enqueue: fresh }) => {
            const repo = makeRepo({
                findActiveBySourceHash: jest
                    .fn()
                    .mockResolvedValue({ id: 7, status: 'downloading' }),
            });
            const db = makeDb();
            const result = await fresh(
                { sourceUrl: 'https://x.example/y', layerCode: 'cp_flood_event' },
                { db, repo },
            );
            expect(result).toEqual({
                job: { id: 7, status: 'downloading' },
                deduplicated: true,
            });
            expect(db.pool.connect).not.toHaveBeenCalled();
            expect(repo.insertJob).not.toHaveBeenCalled();
        });
    });

    test('inserts a new job under an advisory lock when nothing is active', async () => {
        await withRasterIngestEnabled(async ({ enqueue: fresh }) => {
            const repo = makeRepo();
            const db = makeDb();
            const result = await fresh(
                {
                    sourceUrl: 'https://x.example/y?token=abc',
                    layerCode: 'cp_flood_event',
                    user: { id: 42 },
                },
                { db, repo },
            );
            expect(result).toEqual({
                job: { id: 42, status: 'pending' },
                deduplicated: false,
            });
            const queries = db.__client.query.mock.calls.map((c) => c[0]);
            expect(queries).toContain('BEGIN');
            expect(queries.some((q) => q.includes('pg_advisory_xact_lock'))).toBe(true);
            expect(queries).toContain('COMMIT');
            expect(repo.insertJob).toHaveBeenCalledWith(
                db.__client,
                expect.objectContaining({
                    layerCode: 'cp_flood_event',
                    sourceKind: 'gee_download_url',
                    createdBy: 42,
                }),
            );
            expect(db.__client.release).toHaveBeenCalled();
        });
    });

    test('dedupes by layer_code inside the transaction when the fast path missed', async () => {
        await withRasterIngestEnabled(async ({ enqueue: fresh }) => {
            const repo = makeRepo({
                findActiveByLayerCode: jest
                    .fn()
                    .mockResolvedValue({ id: 11, status: 'downloading' }),
            });
            const db = makeDb();
            const result = await fresh(
                { sourceUrl: 'https://x.example/y', layerCode: 'cp_flood_event' },
                { db, repo },
            );
            expect(result.deduplicated).toBe(true);
            expect(repo.insertJob).not.toHaveBeenCalled();
        });
    });

    test('translates a 23505 race collision into a dedupe hit', async () => {
        await withRasterIngestEnabled(async ({ enqueue: fresh }) => {
            const findMock = jest
                .fn()
                .mockResolvedValueOnce(null) // fast-path lookup
                .mockResolvedValueOnce({ id: 99, status: 'downloading' }); // post-rollback
            const repo = makeRepo({
                findActiveBySourceHash: findMock,
                insertJob: jest
                    .fn()
                    .mockRejectedValue(
                        Object.assign(new Error('unique_violation'), { code: '23505' }),
                    ),
            });
            const db = makeDb();
            const result = await fresh(
                { sourceUrl: 'https://x.example/y', layerCode: 'cp_flood_event' },
                { db, repo },
            );
            expect(result).toEqual({
                job: { id: 99, status: 'downloading' },
                deduplicated: true,
            });
            expect(db.__client.release).toHaveBeenCalled();
        });
    });

    test('re-throws non-dedupe DB errors after rollback + release', async () => {
        await withRasterIngestEnabled(async ({ enqueue: fresh }) => {
            const boom = Object.assign(new Error('constraint x'), { code: '23514' });
            const repo = makeRepo({ insertJob: jest.fn().mockRejectedValue(boom) });
            const db = makeDb();
            await expect(
                fresh(
                    { sourceUrl: 'https://x.example/y', layerCode: 'cp_flood_event' },
                    { db, repo },
                ),
            ).rejects.toBe(boom);
            expect(db.__client.release).toHaveBeenCalled();
        });
    });

    test('throws Api503Error when the repo module is not yet installed', async () => {
        await withRasterIngestEnabled(async ({ enqueue: fresh }) => {
            await expect(
                fresh(
                    { sourceUrl: 'https://x.example/y', layerCode: 'cp_flood_event' },
                    { db: makeDb(), repo: null },
                ),
            ).rejects.toBeInstanceOf(Api503Error);
        });
    });
});
