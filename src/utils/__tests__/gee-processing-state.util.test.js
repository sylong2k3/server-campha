'use strict';

jest.mock('../../queues/gee-task.queue', () => ({ getState: jest.fn() }));

const geeQueue = require('../../queues/gee-task.queue');
const { buildGeeProcessingState } = require('../gee-processing-state.util');

const queueState = (overrides = {}) => ({
    concurrency: 1,
    maxPending: 6,
    capacityRemaining: 6,
    accepting: true,
    active: null,
    pending: [],
    ...overrides,
});

describe('buildGeeProcessingState', () => {
    test('always supplies the complete UI processing contract', () => {
        geeQueue.getState.mockReturnValue(queueState());

        const result = buildGeeProcessingState({ pipeline: 'forest-classification' });

        expect(result).toMatchObject({
            pipeline: 'forest-classification',
            state: 'idle',
            queue: { status: 'idle', waitingCount: 0 },
            districtExport: { status: 'not_started', total: 0 },
            retry: { count: 0, nextRetryAt: null, lastError: null },
        });
    });

    test('reports the matching queued forest run and persisted retry state', () => {
        const taskKey = 'analysis:forest-classification:2026-08';
        geeQueue.getState.mockReturnValue(
            queueState({
                capacityRemaining: 4,
                active: { key: 'analysis:flood:2026-08', enqueuedAt: '2026-08-01T00:00:00Z' },
                pending: [{ key: taskKey, enqueuedAt: '2026-08-01T00:01:00Z' }],
            }),
        );

        const result = buildGeeProcessingState({
            pipeline: 'forest-classification',
            taskKey,
            snapshot: { retry_count: 2, next_retry_at: '2026-08-01T01:00:00Z' },
        });

        expect(result).toMatchObject({
            state: 'queued',
            queue: { status: 'queued', position: 2, jobsAhead: 1, globalBusy: true },
            retry: { count: 2, nextRetryAt: '2026-08-01T01:00:00Z' },
        });
    });
});
