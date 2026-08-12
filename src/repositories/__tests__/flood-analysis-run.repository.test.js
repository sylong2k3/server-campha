'use strict';

jest.mock('../../configs/database', () => {
    const client = { query: jest.fn(), release: jest.fn() };
    const pool = { connect: jest.fn().mockResolvedValue(client) };
    const query = jest.fn();
    return { pool, query, __client: client, __rootQuery: query };
});

const db = require('../../configs/database');
const repo = require('../flood-analysis-run.repository');

const makeRow = (patch = {}) => ({
    id: 1,
    analysis_key: 'flood:event:2026-08-11',
    attempt_no: 1,
    module: 'event',
    mode: 'product',
    status: 'QUEUED',
    ...patch,
});

const reset = () => {
    db.__client.query.mockReset();
    db.__client.release.mockReset();
    db.__rootQuery.mockReset();
    db.pool.connect.mockClear();
};

describe('flood-analysis-run.repository', () => {
    describe('constants', () => {
        test('LIVE_STATUSES covers every mid-pipeline state', () => {
            expect(repo.LIVE_STATUSES).toEqual([
                'QUEUED',
                'COMPUTING',
                'EXPORTING',
                'HARVESTING',
                'VALIDATING',
                'ARCHIVING',
                'PUBLISHING',
            ]);
        });
        test('TERMINAL_STATUSES matches the migration CHECK enum', () => {
            expect(repo.TERMINAL_STATUSES).toEqual(['SUCCEEDED', 'FAILED', 'CANCELLED', 'DLQ']);
        });
        test('AUDIT_ACTIONS matches the migration CHECK enum', () => {
            expect(repo.AUDIT_ACTIONS).toEqual([
                'submit',
                'rerun',
                'cancel',
                'publish',
                'unpublish',
                'retry_publish',
                'discard_artifact',
            ]);
        });
    });

    describe('findById + findLatestByModule', () => {
        test('findById passes the row through unchanged', async () => {
            reset();
            db.__rootQuery.mockResolvedValueOnce({ rows: [makeRow({ id: 7 })] });
            const row = await repo.findById(7);
            expect(row).toMatchObject({ id: 7 });
        });

        test('findLatestByModule defaults to SUCCEEDED-only', async () => {
            reset();
            db.__rootQuery.mockResolvedValueOnce({ rows: [makeRow()] });
            await repo.findLatestByModule('event');
            const [sql] = db.__rootQuery.mock.calls[0];
            expect(sql).toMatch(/status = 'SUCCEEDED'/);
        });

        test('findLatestByModule can include non-succeeded runs when asked', async () => {
            reset();
            db.__rootQuery.mockResolvedValueOnce({ rows: [] });
            await repo.findLatestByModule('event', { onlySucceeded: false });
            const [sql] = db.__rootQuery.mock.calls[0];
            expect(sql).not.toMatch(/status = 'SUCCEEDED'/);
        });
    });

    describe('list', () => {
        test('applies every optional filter and clamps limit to 100', async () => {
            reset();
            db.__rootQuery.mockResolvedValueOnce({
                rows: [
                    { id: 1, total_count: 3 },
                    { id: 2, total_count: 3 },
                ],
            });
            const result = await repo.list({
                module: 'rain',
                status: 'SUCCEEDED',
                from: '2026-08-01',
                to: '2026-08-11',
                startedBy: 42,
                limit: 500,
                offset: 20,
            });
            expect(result.total).toBe(3);
            expect(result.items).toHaveLength(2);
            const [, params] = db.__rootQuery.mock.calls[0];
            // Limit clamped to 100
            expect(params[params.length - 2]).toBe(100);
            expect(params[params.length - 1]).toBe(20);
        });

        test('no filters = plain ORDER BY with LIMIT/OFFSET', async () => {
            reset();
            db.__rootQuery.mockResolvedValueOnce({ rows: [] });
            await repo.list({});
            const [sql] = db.__rootQuery.mock.calls[0];
            expect(sql).not.toMatch(/WHERE/);
            expect(sql).toMatch(/ORDER BY created_at DESC/);
        });
    });

    describe('nextAttemptNo', () => {
        test('returns MAX(attempt_no) + 1 for a given analysis_key', async () => {
            reset();
            db.__rootQuery.mockResolvedValueOnce({ rows: [{ next: 3 }] });
            const next = await repo.nextAttemptNo('flood:event:2026-08-11');
            expect(next).toBe(3);
        });
        test('returns 1 for a brand-new key', async () => {
            reset();
            db.__rootQuery.mockResolvedValueOnce({ rows: [{ next: 1 }] });
            expect(await repo.nextAttemptNo('flood:new:x')).toBe(1);
        });
    });

    describe('create', () => {
        test('serialises params_snapshot as JSONB and returns the row', async () => {
            reset();
            db.__rootQuery.mockResolvedValueOnce({ rows: [makeRow({ id: 100 })] });
            const row = await repo.create({
                analysisKey: 'k',
                attemptNo: 2,
                module: 'event',
                mode: 'product',
                pipelineVersion: 'FLOOD_EVENT_V1',
                configVersion: 'V1',
                paramsSnapshot: { s1: { orbitPass: 'AUTO' } },
                aoiSource: 'REFERENCE_GAUL',
                startedBy: 3,
            });
            expect(row.id).toBe(100);
            const [, params] = db.__rootQuery.mock.calls[0];
            expect(params[7]).toBe(JSON.stringify({ s1: { orbitPass: 'AUTO' } }));
            expect(params[8]).toBe('REFERENCE_GAUL');
        });
    });

    describe('startRun', () => {
        test('sets status=COMPUTING and stamps started_at only if unset', async () => {
            reset();
            db.__rootQuery.mockResolvedValueOnce({ rows: [makeRow({ status: 'COMPUTING' })] });
            await repo.startRun(1);
            const [sql] = db.__rootQuery.mock.calls[0];
            expect(sql).toMatch(/started_at = COALESCE\(started_at, NOW\(\)\)/);
        });
    });

    describe('updateStatus', () => {
        test('serialises gee_task_ids + warnings as JSONB when supplied', async () => {
            reset();
            db.__rootQuery.mockResolvedValueOnce({ rows: [makeRow()] });
            await repo.updateStatus(1, {
                status: 'EXPORTING',
                stage: 'submitExport',
                geeTaskIds: { main_flood_non_tidal: 'TASK123' },
                warnings: ['no CHIRPS data'],
            });
            const [sql, params] = db.__rootQuery.mock.calls[0];
            expect(sql).toMatch(/gee_task_ids = \$/);
            expect(sql).toMatch(/warnings = \$/);
            expect(params).toContain(JSON.stringify({ main_flood_non_tidal: 'TASK123' }));
        });
        test('returns null when no patches were supplied', async () => {
            reset();
            expect(await repo.updateStatus(1, {})).toBeNull();
        });
    });

    describe('finishRun', () => {
        test('always sets finished_at=NOW and defaults status=SUCCEEDED', async () => {
            reset();
            db.__rootQuery.mockResolvedValueOnce({ rows: [makeRow({ status: 'SUCCEEDED' })] });
            await repo.finishRun(1);
            const [sql, params] = db.__rootQuery.mock.calls[0];
            expect(sql).toMatch(/finished_at = NOW\(\)/);
            expect(params).toEqual([1, 'SUCCEEDED']);
        });
        test('preserves supplied warnings + error metadata', async () => {
            reset();
            db.__rootQuery.mockResolvedValueOnce({ rows: [makeRow()] });
            await repo.finishRun(1, {
                status: 'FAILED',
                errorCode: 'GEE_TIMEOUT',
                errorMessageSafe: 'graph timed out',
            });
            const [, params] = db.__rootQuery.mock.calls[0];
            expect(params).toEqual([1, 'FAILED', 'GEE_TIMEOUT', 'graph timed out']);
        });
    });

    describe('failInterruptedActiveRuns', () => {
        test('UPDATEs every LIVE_STATUS row and returns the affected metadata', async () => {
            reset();
            db.__rootQuery.mockResolvedValueOnce({
                rows: [
                    { id: 1, module: 'event' },
                    { id: 2, module: 'hand' },
                ],
            });
            const result = await repo.failInterruptedActiveRuns();
            expect(result).toHaveLength(2);
            const [sql, params] = db.__rootQuery.mock.calls[0];
            expect(sql).toMatch(/status = ANY/);
            expect(params[0]).toBe('INTERRUPTED_ON_RESTART');
            expect(params[1]).toEqual(repo.LIVE_STATUSES);
        });
    });

    describe('createStageEvent + listStageEvents', () => {
        test('createStageEvent JSON-encodes detail when supplied', async () => {
            reset();
            db.__rootQuery.mockResolvedValueOnce({ rows: [{ id: 1 }] });
            await repo.createStageEvent({
                analysisRunId: 1,
                stage: 'COMPUTING',
                eventType: 'stage_start',
                elapsedMs: 0,
                detail: { orbitKey: 'ASC_54' },
            });
            const [, params] = db.__rootQuery.mock.calls[0];
            expect(params).toEqual([1, 'COMPUTING', 'stage_start', 0, 1, JSON.stringify({ orbitKey: 'ASC_54' })]);
        });

        test('listStageEvents clamps limit to [1, 500]', async () => {
            reset();
            db.__rootQuery.mockResolvedValueOnce({ rows: [] });
            await repo.listStageEvents(7, { limit: 5000 });
            const [, params] = db.__rootQuery.mock.calls[0];
            expect(params).toEqual([7, 500]);
        });
    });

    describe('insertAudit', () => {
        test('rejects unsupported action codes', async () => {
            await expect(
                repo.insertAudit({
                    analysisRunId: 1,
                    actorUserId: 3,
                    action: 'malicious_verb',
                }),
            ).rejects.toThrow(/Unsupported audit action/);
        });
        test('accepts every documented action', async () => {
            reset();
            db.__rootQuery.mockResolvedValue({ rows: [{ id: 1 }] });
            for (const action of repo.AUDIT_ACTIONS) {
                await expect(
                    repo.insertAudit({ actorUserId: 3, action }),
                ).resolves.toBeTruthy();
            }
        });
    });
});
