'use strict';

// The queue module reads env vars at require-time and holds module-level state
// (pending, active, keyedPromises), so we need to reload only the queue module
// per test. Reloading error.response too would create duplicate error classes
// and break `instanceof` checks — clear only the queue from require cache.
const { Api429Error, Api503Error } = require('../../core/error.response');

const QUEUE_PATH = require.resolve('../gee-task.queue');

const loadQueue = (env = {}) => {
    const original = { ...process.env };
    for (const [key, value] of Object.entries(env)) {
        if (value === undefined) {delete process.env[key];}
        else {process.env[key] = String(value);}
    }
    delete require.cache[QUEUE_PATH];
    const mod = require('../gee-task.queue');
    for (const key of Object.keys(env)) {
        if (original[key] === undefined) {delete process.env[key];}
        else {process.env[key] = original[key];}
    }
    return mod;
};

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('gee-task.queue', () => {
    let queue;
    let logSpies;

    beforeEach(() => {
        // Silence log noise; the queue is chatty by design.
        logSpies = {
            info: jest.spyOn(console, 'info').mockImplementation(() => {}),
            warn: jest.spyOn(console, 'warn').mockImplementation(() => {}),
            error: jest.spyOn(console, 'error').mockImplementation(() => {}),
        };
        queue = loadQueue({
            GEE_QUEUE_MAX_PENDING: 3,
            GEE_QUEUE_RECENT_RETENTION_MS: 60000,
            GEE_MANUAL_COOLDOWN_MS: 0,
        });
    });

    afterEach(() => {
        for (const spy of Object.values(logSpies)) {spy.mockRestore();}
    });

    test('CONCURRENCY is hard-clamped to 1', () => {
        expect(queue.CONCURRENCY).toBe(1);
    });

    test('runs a single task and resolves with its result', async () => {
        const result = await queue.enqueue({
            label: 'unit-1',
            run: async () => 'ok',
        });
        expect(result).toBe('ok');
    });

    test('deduplicates concurrent enqueues sharing the same key', async () => {
        let calls = 0;
        const slow = () =>
            new Promise((resolve) =>
                setTimeout(() => {
                    calls += 1;
                    resolve(calls);
                }, 0),
            );
        const a = queue.enqueue({ key: 'dedup-1', label: 'A', run: slow });
        const b = queue.enqueue({ key: 'dedup-1', label: 'B', run: slow });
        expect(a).toBe(b);
        await expect(a).resolves.toBe(1);
        expect(calls).toBe(1);
    });

    test('runs tasks serially even when many are queued', async () => {
        const order = [];
        const make = (name) => async () => {
            order.push(`start:${name}`);
            await flush();
            order.push(`end:${name}`);
            return name;
        };
        const p1 = queue.enqueue({ label: 'A', run: make('A') });
        const p2 = queue.enqueue({ label: 'B', run: make('B') });
        const p3 = queue.enqueue({ label: 'C', run: make('C') });
        await Promise.all([p1, p2, p3]);
        expect(order).toEqual([
            'start:A',
            'end:A',
            'start:B',
            'end:B',
            'start:C',
            'end:C',
        ]);
    });

    test('higher-priority tasks run before lower-priority ones queued earlier', async () => {
        const order = [];
        // Block the queue with a task in flight so subsequent enqueues sort.
        const blockRelease = defer();
        const blocker = queue.enqueue({
            label: 'blocker',
            run: () => blockRelease.promise,
        });
        await flush();
        queue.enqueue({
            label: 'low',
            priority: 0,
            run: async () => order.push('low'),
        });
        queue.enqueue({
            label: 'mid',
            priority: 5,
            run: async () => order.push('mid'),
        });
        queue.enqueue({
            label: 'high',
            priority: 10,
            run: async () => order.push('high'),
        });
        blockRelease.resolve();
        await blocker;
        await queue.onIdle();
        expect(order).toEqual(['high', 'mid', 'low']);
    });

    test('rejects with Api503Error when pending queue is full', async () => {
        const gate = defer();
        // Fill: 1 active + MAX_PENDING (3) queued = 4 total.
        queue.enqueue({ label: 'active', run: () => gate.promise });
        await flush();
        queue.enqueue({ label: 'q1', run: async () => {} });
        queue.enqueue({ label: 'q2', run: async () => {} });
        queue.enqueue({ label: 'q3', run: async () => {} });
        expect(() =>
            queue.enqueue({ label: 'overflow', run: async () => {} }),
        ).toThrow(Api503Error);
        gate.resolve();
        await queue.onIdle();
    });

    test('applies key cooldown after completion and throws Api429Error with retryAfterMs', async () => {
        // Fresh instance with a positive cooldown.
        const q = loadQueue({
            GEE_QUEUE_MAX_PENDING: 3,
            GEE_MANUAL_COOLDOWN_MS: 60000,
        });
        await q.enqueue({ key: 'cool-1', label: 'first', run: async () => 42 });
        let caught;
        try {
            q.enqueue({
                key: 'cool-1',
                label: 'second',
                cooldownMs: 60000,
                run: async () => 'nope',
            });
        } catch (error) {
            caught = error;
        }
        expect(caught).toBeInstanceOf(Api429Error);
        expect(caught.retryAfterMs).toBeGreaterThan(0);
    });

    test('rejects new enqueues with Api503Error when stopped', () => {
        queue.stop();
        expect(() => queue.enqueue({ label: 'x', run: async () => {} })).toThrow(
            Api503Error,
        );
        queue.start();
    });

    test('preserves the caller error when the run() function rejects', async () => {
        const boom = new Error('graph broke');
        await expect(
            queue.enqueue({ label: 'boom', run: async () => Promise.reject(boom) }),
        ).rejects.toBe(boom);
    });

    test('getState reports capacity and pending metadata', async () => {
        const gate = defer();
        queue.enqueue({ label: 'active', run: () => gate.promise });
        await flush();
        queue.enqueue({ label: 'queued-1', priority: 2, run: async () => {} });
        const state = queue.getState();
        expect(state.concurrency).toBe(1);
        expect(state.maxPending).toBe(3);
        expect(state.active).toMatchObject({ label: 'active' });
        expect(state.pending).toHaveLength(1);
        expect(state.pending[0]).toMatchObject({ label: 'queued-1', priority: 2 });
        gate.resolve();
        await queue.onIdle();
    });

    test('enqueue rejects synchronously when run is missing', () => {
        return expect(queue.enqueue({ label: 'x' })).rejects.toBeInstanceOf(TypeError);
    });
});

function defer() {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}
