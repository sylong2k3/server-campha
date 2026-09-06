'use strict';

jest.mock('../../configs/database', () => ({
    getClient: jest.fn(),
    query: jest.fn(),
}));
const db = require('../../configs/database');
const repository = require('../layer-job.repository');

describe('layer-job repository cleanup completion', () => {
    test('detaches Time Series members only after lease-safe job completion', async () => {
        const client = {
            query: jest
                .fn()
                .mockResolvedValueOnce({})
                .mockResolvedValueOnce({ rowCount: 1 })
                .mockResolvedValueOnce({ rows: [] })
                .mockResolvedValueOnce({ rowCount: 1 })
                .mockResolvedValueOnce({ rowCount: 4 })
                .mockResolvedValueOnce({ rowCount: 1 })
                .mockResolvedValueOnce({}),
            release: jest.fn(),
        };
        db.getClient.mockResolvedValue(client);

        await expect(repository.completeCleanup(7, 'worker-a', 9)).resolves.toBe(true);

        expect(client.query.mock.calls.map(([sql]) => sql)).toEqual([
            'BEGIN',
            expect.stringContaining("SET status = 'succeeded'"),
            expect.stringContaining('ORDER BY acquired_at,id FOR UPDATE'),
            "UPDATE gis.layers SET cleanup_status = 'complete' WHERE id = $1",
            'UPDATE raster.satellite_images SET layer_id=NULL WHERE layer_id=$1',
            'UPDATE raster.satellite_images SET standalone_layer_id=NULL WHERE standalone_layer_id=$1',
            'COMMIT',
        ]);
        expect(client.query.mock.calls[1][0]).toContain('layer_id = $3');
        expect(client.query.mock.calls[1][0]).toContain('deleted_at IS NOT NULL');
        expect(client.query.mock.calls[1][0]).toContain('lease_expires_at > NOW()');
        expect(client.query.mock.calls[1][1]).toEqual([7, 'worker-a', 9]);
        expect(client.query.mock.calls[2][0]).toContain(
            'WHERE layer_id=$1 OR standalone_layer_id=$1',
        );
        expect(client.query.mock.calls[4][1]).toEqual([9]);
        expect(client.query.mock.calls[5][1]).toEqual([9]);
        expect(client.release).toHaveBeenCalled();
    });

    test('does not detach members when cleanup lease is lost', async () => {
        const client = {
            query: jest
                .fn()
                .mockResolvedValueOnce({})
                .mockResolvedValueOnce({ rowCount: 0 })
                .mockResolvedValueOnce({}),
            release: jest.fn(),
        };
        db.getClient.mockResolvedValue(client);

        await expect(repository.completeCleanup(7, 'worker-a', 9)).resolves.toBe(false);

        expect(client.query).not.toHaveBeenCalledWith(
            'UPDATE raster.satellite_images SET layer_id=NULL WHERE layer_id=$1',
            expect.anything(),
        );
        expect(
            client.query.mock.calls.some(([sql]) => sql.includes('UPDATE raster.satellite_images')),
        ).toBe(false);
        expect(client.query).toHaveBeenLastCalledWith('ROLLBACK');
    });

    test('marks the layer failed when cleanup exhausts expired leases', async () => {
        const client = { query: jest.fn().mockResolvedValue({ rows: [] }), release: jest.fn() };
        db.getClient.mockResolvedValue(client);
        await expect(repository.claimCleanup('worker-a')).resolves.toBeNull();
        const [sql] = client.query.mock.calls.find(([sql]) => sql.includes('WITH exhausted'));
        expect(sql).toContain('c.attempt >= c.max_attempts');
        expect(sql).toContain("UPDATE gis.layers SET cleanup_status = 'failed'");
        expect(sql).toContain('id IN (SELECT layer_id FROM exhausted)');
        expect(
            client.query.mock.calls.some(([sql]) => sql.includes('UPDATE raster.satellite_images')),
        ).toBe(false);
    });

    test('failed cleanup keeps both links for a future worker retry', async () => {
        const client = { query: jest.fn().mockResolvedValue({ rowCount: 1 }), release: jest.fn() };
        db.getClient.mockResolvedValue(client);
        await expect(
            repository.failCleanup(
                { id: 7, layer_id: 9, attempt: 5, max_attempts: 5 },
                'worker-a',
                'failed',
            ),
        ).resolves.toBe(true);
        expect(client.query).toHaveBeenCalledWith(
            'UPDATE gis.layers SET cleanup_status = $2 WHERE id = $1',
            [9, 'failed'],
        );
        expect(
            client.query.mock.calls.some(([sql]) => sql.includes('UPDATE raster.satellite_images')),
        ).toBe(false);
    });
});

describe('layer-job repository cleanup retry', () => {
    const layerRow = { id: 9 };
    const buildClient = (queueMock) => ({
        query: jest.fn((sql, params) => queueMock(sql, params)),
        release: jest.fn(),
    });

    test('retryCleanup returns null when layer does not exist', async () => {
        const client = buildClient((sql) => {
            if (sql === 'BEGIN') {
                return {};
            }
            if (sql.includes('FOR UPDATE')) {
                return { rows: [] };
            }
            if (sql === 'ROLLBACK') {
                return {};
            }
            throw new Error(`unexpected: ${sql}`);
        });
        db.getClient.mockResolvedValue(client);
        await expect(repository.retryCleanup(9)).resolves.toBeNull();
        expect(client.query).toHaveBeenLastCalledWith('ROLLBACK');
    });

    test.each([
        [
            'layer not deleted',
            { deleted_at: null, cleanup_status: 'queued', job_status: null },
            'LAYER_NOT_DELETED',
        ],
        [
            'job queued',
            { deleted_at: '2026-01-01', cleanup_status: 'queued', job_status: 'queued' },
            'LAYER_CLEANUP_ALREADY_ACTIVE',
        ],
        [
            'job running',
            { deleted_at: '2026-01-01', cleanup_status: 'running', job_status: 'running' },
            'LAYER_CLEANUP_ALREADY_ACTIVE',
        ],
        [
            'already complete',
            { deleted_at: '2026-01-01', cleanup_status: 'complete', job_status: 'failed' },
            'LAYER_CLEANUP_NOT_RETRYABLE',
        ],
        [
            'no job yet',
            { deleted_at: '2026-01-01', cleanup_status: 'queued', job_status: null },
            'LAYER_CLEANUP_NOT_RETRYABLE',
        ],
        [
            'job succeeded',
            { deleted_at: '2026-01-01', cleanup_status: 'queued', job_status: 'succeeded' },
            'LAYER_CLEANUP_NOT_RETRYABLE',
        ],
    ])('rejects retry when %s', async (_label, statusFields, conflict) => {
        let statusCalls = 0;
        const client = buildClient((sql) => {
            if (sql === 'BEGIN') {
                return {};
            }
            if (sql.includes('FOR UPDATE') && sql.includes('gis.layers')) {
                return { rows: [layerRow] };
            }
            if (sql.includes('LEFT JOIN LATERAL')) {
                statusCalls += 1;
                return {
                    rows: [{ layer_id: 9, code: 'old_code', max_attempts: 5, ...statusFields }],
                };
            }
            if (sql === 'ROLLBACK') {
                return {};
            }
            throw new Error(`unexpected: ${sql}`);
        });
        db.getClient.mockResolvedValue(client);
        await expect(repository.retryCleanup(9)).resolves.toEqual({ conflict });
        expect(statusCalls).toBe(1);
        expect(client.query).toHaveBeenLastCalledWith('ROLLBACK');
    });

    test('queues a new cleanup job and preserves the previous failed job id', async () => {
        let statusCalls = 0;
        const client = buildClient((sql) => {
            if (sql === 'BEGIN' || sql === 'COMMIT') {
                return {};
            }
            if (sql.includes('FOR UPDATE') && sql.includes('gis.layers')) {
                return { rows: [layerRow] };
            }
            if (sql.includes('LEFT JOIN LATERAL')) {
                statusCalls += 1;
                return {
                    rows: [
                        statusCalls === 1
                            ? {
                                  layer_id: 9,
                                  code: 'old_code',
                                  max_attempts: 5,
                                  deleted_at: '2026-01-01',
                                  cleanup_status: 'failed',
                                  job_status: 'failed',
                                  job_id: 41,
                              }
                            : {
                                  layer_id: 9,
                                  code: 'old_code',
                                  max_attempts: 5,
                                  deleted_at: '2026-01-01',
                                  cleanup_status: 'queued',
                                  job_status: 'queued',
                                  job_id: 42,
                              },
                    ],
                };
            }
            if (sql.includes('INSERT INTO gis.layer_cleanup_jobs')) {
                return { rows: [{ id: 42 }] };
            }
            if (sql.includes("cleanup_status='queued'")) {
                return { rowCount: 1 };
            }
            throw new Error(`unexpected: ${sql}`);
        });
        db.getClient.mockResolvedValue(client);
        await expect(repository.retryCleanup(9)).resolves.toEqual({
            state: expect.objectContaining({ job_id: 42, job_status: 'queued' }),
            previousJobId: 41,
        });
        expect(client.query).toHaveBeenCalledWith(
            expect.stringContaining('ON CONFLICT (layer_id) WHERE status IN'),
            [9, 5],
        );
        expect(client.query).toHaveBeenLastCalledWith('COMMIT');
    });

    test('rolls back when the unique active-job index races the insert', async () => {
        const client = buildClient((sql) => {
            if (sql === 'BEGIN') {
                return {};
            }
            if (sql.includes('FOR UPDATE') && sql.includes('gis.layers')) {
                return { rows: [layerRow] };
            }
            if (sql.includes('LEFT JOIN LATERAL')) {
                return {
                    rows: [
                        {
                            layer_id: 9,
                            code: 'old_code',
                            max_attempts: 5,
                            deleted_at: '2026-01-01',
                            cleanup_status: 'failed',
                            job_status: 'failed',
                            job_id: 41,
                        },
                    ],
                };
            }
            if (sql.includes('INSERT INTO gis.layer_cleanup_jobs')) {
                return { rows: [] };
            }
            if (sql === 'ROLLBACK') {
                return {};
            }
            throw new Error(`unexpected: ${sql}`);
        });
        db.getClient.mockResolvedValue(client);
        await expect(repository.retryCleanup(9)).resolves.toEqual({
            conflict: 'LAYER_CLEANUP_ALREADY_ACTIVE',
        });
        expect(client.query).toHaveBeenLastCalledWith('ROLLBACK');
    });
});
