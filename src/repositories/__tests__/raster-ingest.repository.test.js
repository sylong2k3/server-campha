'use strict';

// Replace the database module with an in-memory query recorder so we can
// assert on the exact SQL each repo method emits, without needing Postgres.
jest.mock('../../configs/database', () => {
    const client = {
        query: jest.fn(),
        release: jest.fn(),
    };
    const pool = {
        connect: jest.fn().mockResolvedValue(client),
    };
    const rootQuery = jest.fn();
    return { pool, query: rootQuery, __client: client, __rootQuery: rootQuery };
});

const db = require('../../configs/database');
const repo = require('../raster-ingest.repository');

const makeRow = (patch = {}) => ({
    id: 1,
    layer_code: 'cp_flood_event',
    status: 'pending',
    retry_count: 0,
    ...patch,
});

const resetMocks = () => {
    db.__client.query.mockReset();
    db.__client.release.mockReset();
    db.pool.connect.mockClear();
    db.__rootQuery.mockReset();
};

describe('raster-ingest.repository', () => {
    describe('findById / findActiveBySourceHash / findActiveByLayerCode', () => {
        test('findById passes the id and returns the first row', async () => {
            resetMocks();
            db.__rootQuery.mockResolvedValueOnce({ rows: [makeRow({ id: 42 })] });
            const row = await repo.findById(42);
            expect(row).toMatchObject({ id: 42 });
            const [sql, params] = db.__rootQuery.mock.calls[0];
            expect(sql).toMatch(/FROM gis\.raster_ingest_jobs/);
            expect(params).toEqual([42]);
        });

        test('findActiveBySourceHash restricts to ACTIVE_STATES', async () => {
            resetMocks();
            db.__rootQuery.mockResolvedValueOnce({ rows: [makeRow()] });
            await repo.findActiveBySourceHash('a'.repeat(64));
            const [, params] = db.__rootQuery.mock.calls[0];
            expect(params[0]).toBe('a'.repeat(64));
            expect(params[1]).toEqual(repo.ACTIVE_STATES);
        });

        test('findActiveByLayerCode accepts an optional client (transaction case)', async () => {
            const client = { query: jest.fn().mockResolvedValue({ rows: [makeRow()] }) };
            await repo.findActiveByLayerCode('cp_flood_event', client);
            expect(client.query).toHaveBeenCalled();
        });
    });

    describe('listByLayerCode', () => {
        test('returns items + total from the window-count row', async () => {
            resetMocks();
            db.__rootQuery.mockResolvedValueOnce({
                rows: [
                    { id: 1, layer_code: 'x', total_count: 7 },
                    { id: 2, layer_code: 'x', total_count: 7 },
                ],
            });
            const result = await repo.listByLayerCode('x', { limit: 10, offset: 20 });
            expect(result.total).toBe(7);
            expect(result.items).toHaveLength(2);
            expect(result.items[0]).not.toHaveProperty('total_count');
            const [, params] = db.__rootQuery.mock.calls[0];
            expect(params).toEqual(['x', 10, 20]);
        });
    });

    describe('insertJob', () => {
        test('inserts under the caller-supplied transaction client', async () => {
            const client = { query: jest.fn().mockResolvedValue({ rows: [makeRow()] }) };
            await repo.insertJob(client, {
                layerCode: 'cp_flood_event',
                sourceUrl: 'https://x/y',
                sourceHash: 'b'.repeat(64),
                requestParams: { bucketCategory: 'flood-rasters' },
                createdBy: 3,
            });
            const [sql, params] = client.query.mock.calls[0];
            expect(sql).toMatch(/INSERT INTO gis\.raster_ingest_jobs/);
            expect(params).toEqual([
                'cp_flood_event',
                'gee_download_url',
                'https://x/y',
                'b'.repeat(64),
                JSON.stringify({ bucketCategory: 'flood-rasters' }),
                3,
            ]);
        });
    });

    describe('updateStatus', () => {
        test('builds a SET clause containing only the supplied patches', async () => {
            resetMocks();
            db.__rootQuery.mockResolvedValueOnce({ rows: [makeRow({ status: 'validating' })] });
            const result = await repo.updateStatus(7, { status: 'validating', progress: 30 });
            expect(result.status).toBe('validating');
            const [sql, params] = db.__rootQuery.mock.calls[0];
            expect(sql).toMatch(/status = \$2/);
            expect(sql).toMatch(/progress = \$3/);
            expect(params).toEqual([7, 'validating', 30]);
        });

        test('stamps completed_at when the transition ends the pipeline', async () => {
            resetMocks();
            db.__rootQuery.mockResolvedValueOnce({ rows: [makeRow({ status: 'completed' })] });
            await repo.updateStatus(8, { status: 'completed', progress: 100 });
            const [sql] = db.__rootQuery.mock.calls[0];
            expect(sql).toMatch(/completed_at = NOW\(\)/);
        });

        test('returns null when no patches were provided', async () => {
            const result = await repo.updateStatus(9, {});
            expect(result).toBeNull();
        });
    });

    describe('incrementRetry', () => {
        test('bumps retry_count and schedules a next_attempt_at when backoff is set', async () => {
            resetMocks();
            db.__rootQuery.mockResolvedValueOnce({ rows: [makeRow({ retry_count: 2 })] });
            await repo.incrementRetry(11, { nextRetryAtMs: 5000, errorLog: 'boom' });
            const [sql, params] = db.__rootQuery.mock.calls[0];
            expect(sql).toMatch(/retry_count = retry_count \+ 1/);
            expect(sql).toMatch(/status = 'pending'/);
            expect(sql).toMatch(/next_attempt_at = NOW\(\) \+ /);
            expect(params).toEqual([11, 5000, 'boom']);
        });

        test('schedules immediate retry when no backoff is provided', async () => {
            resetMocks();
            db.__rootQuery.mockResolvedValueOnce({ rows: [makeRow()] });
            await repo.incrementRetry(12, {});
            const [sql] = db.__rootQuery.mock.calls[0];
            expect(sql).toMatch(/next_attempt_at = NOW\(\)/);
        });
    });

    describe('moveToDlq', () => {
        test('marks the job dlq and inserts a DLQ record under a transaction', async () => {
            resetMocks();
            db.__client.query.mockImplementation((sql) => {
                if (/^UPDATE gis\.raster_ingest_jobs/.test(sql)) {
                    return Promise.resolve({ rows: [makeRow({ status: 'dlq' })] });
                }
                return Promise.resolve({ rowCount: 1 });
            });
            const result = await repo.moveToDlq(1, {
                errorLog: 'FILE_TOO_LARGE',
                reason: 'NON_RETRYABLE',
                detail: { size: 5e9 },
            });
            expect(result.status).toBe('dlq');
            const queries = db.__client.query.mock.calls.map((c) => c[0]);
            expect(queries).toContain('BEGIN');
            expect(queries).toContain('COMMIT');
            expect(queries.some((q) => q.includes('INSERT INTO gis.raster_ingest_dlq'))).toBe(true);
            expect(db.__client.release).toHaveBeenCalled();
        });

        test('rolls back and re-throws on failure', async () => {
            resetMocks();
            db.__client.query.mockImplementation((sql) => {
                if (sql === 'BEGIN') {
                    return Promise.resolve();
                }
                if (sql === 'ROLLBACK') {
                    return Promise.resolve();
                }
                if (/^UPDATE gis\.raster_ingest_jobs/.test(sql)) {
                    return Promise.reject(new Error('DB down'));
                }
                return Promise.resolve({ rows: [] });
            });
            await expect(repo.moveToDlq(1, { reason: 'NON_RETRYABLE' })).rejects.toThrow('DB down');
            const queries = db.__client.query.mock.calls.map((c) => c[0]);
            expect(queries).toContain('ROLLBACK');
            expect(db.__client.release).toHaveBeenCalled();
        });
    });

    describe('saveOutput', () => {
        test('COALESCEs so a partial patch does not clobber existing fields', async () => {
            resetMocks();
            db.__rootQuery.mockResolvedValueOnce({ rows: [makeRow({ minio_key: 'k' })] });
            await repo.saveOutput(1, {
                minioCategory: 'flood-rasters',
                minioKey: 'flood/2026/08/x/job_1.tif',
                fileSizeBytes: 1234,
                fileSha256: 'c'.repeat(64),
                geoserverStore: 'cp_flood_event_1',
                geoserverLayer: 'campha:cp_flood_event_1',
                layerId: 99,
            });
            const [sql] = db.__rootQuery.mock.calls[0];
            expect(sql).toMatch(/minio_category\s*=\s*COALESCE/);
            expect(sql).toMatch(/geoserver_layer\s*=\s*COALESCE/);
        });
    });

    describe('claimPending', () => {
        test('SELECTs FOR UPDATE SKIP LOCKED then UPDATEs to downloading', async () => {
            resetMocks();
            db.__client.query.mockImplementation((sql) => {
                if (sql === 'BEGIN' || sql === 'COMMIT') {
                    return Promise.resolve();
                }
                if (/SELECT[\s\S]*FOR UPDATE SKIP LOCKED/.test(sql)) {
                    return Promise.resolve({ rows: [makeRow({ id: 5 }), makeRow({ id: 6 })] });
                }
                return Promise.resolve({ rows: [] });
            });
            const claimed = await repo.claimPending({ batchSize: 2, maxRetries: 3 });
            expect(claimed).toHaveLength(2);
            const queries = db.__client.query.mock.calls.map((c) => c[0]);
            expect(queries.some((q) => /FOR UPDATE SKIP LOCKED/.test(q))).toBe(true);
            expect(queries.some((q) => /retry_count <= \$2/.test(q))).toBe(true);
            expect(queries.some((q) => /status = 'downloading'/.test(q))).toBe(true);
            expect(db.__client.release).toHaveBeenCalled();
        });

        test('returns [] and commits when nothing is claimable', async () => {
            resetMocks();
            db.__client.query.mockImplementation((sql) => {
                if (sql === 'BEGIN' || sql === 'COMMIT') {
                    return Promise.resolve();
                }
                return Promise.resolve({ rows: [] });
            });
            const claimed = await repo.claimPending({ batchSize: 1, maxRetries: 3 });
            expect(claimed).toEqual([]);
            expect(db.__client.release).toHaveBeenCalled();
        });
    });

    describe('recoverInterruptedJobs', () => {
        test('moves exhausted jobs to dlq and rewinds the rest to pending', async () => {
            resetMocks();
            db.__client.query.mockImplementation((sql) => {
                if (sql === 'BEGIN' || sql === 'COMMIT') {
                    return Promise.resolve();
                }
                if (/status = 'dlq'/.test(sql)) {
                    return Promise.resolve({ rows: [{ id: 10 }, { id: 11 }] });
                }
                if (/INSERT INTO gis\.raster_ingest_dlq/.test(sql)) {
                    return Promise.resolve({ rowCount: 1 });
                }
                if (/status = 'pending'/.test(sql)) {
                    return Promise.resolve({ rows: [{ id: 12 }] });
                }
                return Promise.resolve({ rows: [] });
            });
            const count = await repo.recoverInterruptedJobs({ maxRetries: 3 });
            expect(count).toBe(3);
            expect(db.__client.release).toHaveBeenCalled();
        });
    });
});
