'use strict';

jest.mock('../../configs/database', () => {
    const client = { query: jest.fn(), release: jest.fn() };
    const pool = { connect: jest.fn().mockResolvedValue(client) };
    const query = jest.fn();
    return { pool, query, __client: client, __rootQuery: query };
});

const db = require('../../configs/database');
const repo = require('../flood-artifact.repository');

const makeRow = (patch = {}) => ({
    id: 1,
    analysis_run_id: 100,
    module: 'event',
    artifact_code: 'main_flood_non_tidal',
    artifact_role: 'PRODUCT',
    publish_status: 'unpublished',
    ...patch,
});

const reset = () => {
    db.__rootQuery.mockReset();
};

describe('flood-artifact.repository', () => {
    describe('constants', () => {
        test('publish status enum matches migration CHECK', () => {
            expect(repo.PUBLISH_STATUSES).toEqual([
                'unpublished',
                'publishing',
                'published',
                'failed',
            ]);
        });
        test('artifact role enum matches migration CHECK', () => {
            expect(repo.ARTIFACT_ROLES).toEqual(['PRODUCT', 'QA', 'CALIBRATION']);
        });
    });

    describe('findById + listByRunId + findByLayerName', () => {
        test('findById returns the first row unchanged', async () => {
            reset();
            db.__rootQuery.mockResolvedValueOnce({ rows: [makeRow({ id: 42 })] });
            expect(await repo.findById(42)).toMatchObject({ id: 42 });
        });
        test('listByRunId ORDERs by id ASC (stable pipeline order)', async () => {
            reset();
            db.__rootQuery.mockResolvedValueOnce({ rows: [makeRow()] });
            await repo.listByRunId(100);
            const [sql, params] = db.__rootQuery.mock.calls[0];
            expect(sql).toMatch(/ORDER BY id ASC/);
            expect(params).toEqual([100]);
        });
        test('findByLayerName restricts to publish_status=published', async () => {
            reset();
            db.__rootQuery.mockResolvedValueOnce({ rows: [] });
            await repo.findByLayerName('campha', 'cp_flood_event_1');
            const [sql, params] = db.__rootQuery.mock.calls[0];
            expect(sql).toMatch(/publish_status = 'published'/);
            expect(params).toEqual(['campha', 'cp_flood_event_1']);
        });
    });

    describe('listPublished', () => {
        test('applies all filters and window-count total', async () => {
            reset();
            db.__rootQuery.mockResolvedValueOnce({
                rows: [
                    { id: 1, total_count: 4 },
                    { id: 2, total_count: 4 },
                ],
            });
            const r = await repo.listPublished({
                module: 'event',
                from: '2026-08-01',
                to: '2026-08-11',
                limit: 300,
                offset: 5,
            });
            expect(r.total).toBe(4);
            expect(r.items).toHaveLength(2);
            expect(r.items[0]).not.toHaveProperty('total_count');
            const [, params] = db.__rootQuery.mock.calls[0];
            // Limit clamped to 100
            expect(params[params.length - 2]).toBe(100);
            expect(params[params.length - 1]).toBe(5);
        });
    });

    describe('createForRun', () => {
        test('inserts a row with the four required fields', async () => {
            reset();
            db.__rootQuery.mockResolvedValueOnce({ rows: [makeRow({ id: 99 })] });
            const row = await repo.createForRun({
                analysisRunId: 100,
                module: 'event',
                artifactCode: 'main_flood_non_tidal',
                artifactRole: 'PRODUCT',
                pipelineVersion: 'FLOOD_EVENT_V1',
            });
            expect(row.id).toBe(99);
            const [, params] = db.__rootQuery.mock.calls[0];
            expect(params).toEqual([
                100,
                'event',
                'main_flood_non_tidal',
                'PRODUCT',
                'FLOOD_EVENT_V1',
                '{}',
            ]);
        });
        test('rejects unsupported artifact_role early (defense-in-depth)', async () => {
            await expect(
                repo.createForRun({
                    analysisRunId: 100,
                    module: 'event',
                    artifactCode: 'x',
                    artifactRole: 'NOT_A_ROLE',
                    pipelineVersion: 'V1',
                }),
            ).rejects.toThrow(/Unsupported artifact_role/);
        });
    });

    describe('updateAssetMetadata', () => {
        test('COALESCE-s every field so a partial patch is idempotent', async () => {
            reset();
            db.__rootQuery.mockResolvedValueOnce({
                rows: [makeRow({ crs: 'EPSG:32648' })],
            });
            await repo.updateAssetMetadata(1, {
                crs: 'EPSG:32648',
                checksumSha256: 'a'.repeat(64),
                sizeBytes: 12345,
                bbox: { xmin: 1, ymin: 2, xmax: 3, ymax: 4 },
            });
            const [sql, params] = db.__rootQuery.mock.calls[0];
            // Every set column uses COALESCE.
            expect((sql.match(/COALESCE/g) || []).length).toBeGreaterThanOrEqual(10);
            expect(params[6]).toBe(12345); // size_bytes at $7
            expect(params[8]).toBe('EPSG:32648'); // crs at $9
            expect(params[13]).toBe(JSON.stringify({ xmin: 1, ymin: 2, xmax: 3, ymax: 4 })); // bbox at $14
        });
    });

    describe('publish-status transitions', () => {
        test('setPublishing stamps workspace/store/layer/style (COALESCE)', async () => {
            reset();
            db.__rootQuery.mockResolvedValueOnce({ rows: [makeRow({ publish_status: 'publishing' })] });
            await repo.setPublishing(1, {
                workspace: 'campha',
                coverageStore: 'cp_flood_event_1',
                layerName: 'cp_flood_event_1',
                styleName: 'flood_main',
            });
            const [sql, params] = db.__rootQuery.mock.calls[0];
            expect(sql).toMatch(/publish_status\s*=\s*'publishing'/);
            expect(params).toEqual([1, 'campha', 'cp_flood_event_1', 'cp_flood_event_1', 'flood_main']);
        });

        test('setPublished stamps published_at=NOW and flips status', async () => {
            reset();
            db.__rootQuery.mockResolvedValueOnce({
                rows: [makeRow({ publish_status: 'published' })],
            });
            await repo.setPublished(1);
            const [sql] = db.__rootQuery.mock.calls[0];
            expect(sql).toMatch(/publish_status\s*=\s*'published'/);
            expect(sql).toMatch(/published_at\s*=\s*NOW\(\)/);
        });

        test('setPublishFailed clears published_at', async () => {
            reset();
            db.__rootQuery.mockResolvedValueOnce({ rows: [makeRow({ publish_status: 'failed' })] });
            await repo.setPublishFailed(1);
            const [sql] = db.__rootQuery.mock.calls[0];
            expect(sql).toMatch(/publish_status\s*=\s*'failed'/);
            expect(sql).toMatch(/published_at\s*=\s*NULL/);
        });

        test('setUnpublished clears published_at and returns to unpublished', async () => {
            reset();
            db.__rootQuery.mockResolvedValueOnce({
                rows: [makeRow({ publish_status: 'unpublished' })],
            });
            await repo.setUnpublished(1);
            const [sql] = db.__rootQuery.mock.calls[0];
            expect(sql).toMatch(/publish_status\s*=\s*'unpublished'/);
            expect(sql).toMatch(/published_at\s*=\s*NULL/);
        });
    });
});
