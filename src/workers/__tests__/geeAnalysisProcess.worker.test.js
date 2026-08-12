'use strict';

const { EventEmitter } = require('events');

// jest.mock is hoisted above local declarations, so the factory must create
// the mock inside itself. We grab the reference back via require() below.
jest.mock('child_process', () => ({ fork: jest.fn() }));
const { fork: forkMock } = require('child_process');

const loadWorker = (env = {}) => {
    const original = {};
    for (const [key, value] of Object.entries(env)) {
        original[key] = process.env[key];
        if (value === undefined) {delete process.env[key];}
        else {process.env[key] = String(value);}
    }
    try {
        // Jest keeps its own module registry independent of require.cache; use its
        // reset hook so PER_KIND_RSS_MB is recomputed with the fresh env.
        jest.resetModules();
        // Re-establish the child_process mock inside the fresh registry, then
        // rehydrate our fork mock reference so tests still see the same jest.fn().
        jest.doMock('child_process', () => ({ fork: forkMock }));
        return require('../geeAnalysisProcess.worker');
    } finally {
        for (const key of Object.keys(env)) {
            if (original[key] === undefined) {delete process.env[key];}
            else {process.env[key] = original[key];}
        }
    }
};

const makeFakeChild = () => {
    const child = new EventEmitter();
    child.pid = 12345;
    child.exitCode = null;
    child.signalCode = null;
    child.kill = jest.fn((signal) => {
        child.killed = true;
        child.lastSignal = signal;
    });
    child.send = jest.fn((_msg, cb) => cb && cb());
    return child;
};

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('geeAnalysisProcess.worker', () => {
    let logSpies;

    beforeEach(() => {
        forkMock.mockReset();
        logSpies = {
            info: jest.spyOn(console, 'info').mockImplementation(() => {}),
            warn: jest.spyOn(console, 'warn').mockImplementation(() => {}),
            error: jest.spyOn(console, 'error').mockImplementation(() => {}),
        };
    });

    afterEach(() => {
        for (const spy of Object.values(logSpies)) {spy.mockRestore();}
    });

    test('resolves with the child result on {type:result} message + exit(0)', async () => {
        const worker = loadWorker();
        const child = makeFakeChild();
        forkMock.mockReturnValue(child);
        const runPromise = worker.run({ kind: 'event', payload: { foo: 1 } });
        await flush();
        expect(child.send).toHaveBeenCalledWith(
            { kind: 'event', payload: { foo: 1 } },
            expect.any(Function),
        );
        child.emit('message', { type: 'result', result: { area: 42 } });
        child.exitCode = 0;
        child.emit('exit', 0, null);
        await expect(runPromise).resolves.toEqual({ area: 42 });
    });

    test('rejects with error detail when child sends {type:error}', async () => {
        const worker = loadWorker();
        const child = makeFakeChild();
        forkMock.mockReturnValue(child);
        const runPromise = worker.run({ kind: 'hand', payload: {} });
        await flush();
        child.emit('message', { type: 'error', error: 'graph blew up' });
        child.exitCode = 1;
        child.emit('exit', 1, null);
        await expect(runPromise).rejects.toThrow('graph blew up');
    });

    test('SIGTERMs the child after two RSS-over-limit samples', async () => {
        const worker = loadWorker({ GEE_CHILD_MAX_RSS_MB_HAND: 1024 });
        const child = makeFakeChild();
        forkMock.mockReturnValue(child);
        const runPromise = worker.run({ kind: 'hand', payload: {} });
        await flush();
        // Send two memory samples above the 1024 MB limit.
        const oneGigOver = 1500 * 1024 * 1024;
        child.emit('message', { type: 'memory', rss: oneGigOver, heapUsed: 0 });
        child.emit('message', { type: 'memory', rss: oneGigOver, heapUsed: 0 });
        expect(child.kill).toHaveBeenCalledWith('SIGTERM');
        // Simulate the child actually exiting after SIGTERM.
        child.exitCode = null;
        child.signalCode = 'SIGTERM';
        child.emit('exit', null, 'SIGTERM');
        await expect(runPromise).rejects.toThrow(/exceeded 1024MB limit for kind=hand/);
    });

    test('does not terminate on a single sample above threshold (needs two)', async () => {
        const worker = loadWorker({ GEE_CHILD_MAX_RSS_MB_RAIN: 1024 });
        const child = makeFakeChild();
        forkMock.mockReturnValue(child);
        const runPromise = worker.run({ kind: 'rain', payload: {} });
        await flush();
        child.emit('message', { type: 'memory', rss: 1500 * 1024 * 1024, heapUsed: 0 });
        expect(child.kill).not.toHaveBeenCalled();
        // Under-limit sample resets the counter.
        child.emit('message', { type: 'memory', rss: 500 * 1024 * 1024, heapUsed: 0 });
        child.emit('message', { type: 'memory', rss: 1500 * 1024 * 1024, heapUsed: 0 });
        // Single over-limit sample after a reset should NOT terminate.
        expect(child.kill).not.toHaveBeenCalled();
        // Now finish normally to let the promise settle.
        child.emit('message', { type: 'result', result: 'ok' });
        child.exitCode = 0;
        child.emit('exit', 0, null);
        await expect(runPromise).resolves.toBe('ok');
    });

    test('per-kind RSS limit selection uses env override then default', () => {
        const worker = loadWorker({
            GEE_CHILD_MAX_RSS_MB: 2048,
            GEE_CHILD_MAX_RSS_MB_EVENT: 4096,
            GEE_CHILD_MAX_RSS_MB_TREND: undefined,
            GEE_CHILD_MAX_RSS_MB_FOREST: 3584,
        });
        expect(worker.resolveRssLimit('event')).toBe(4096);
        expect(worker.resolveRssLimit('trend')).toBeGreaterThanOrEqual(2048);
        expect(worker.resolveRssLimit('forest-classification')).toBe(3584);
        // Unknown kind falls back to the global default.
        expect(worker.resolveRssLimit('what')).toBe(2048);
    });

    test('strips --inspect and --max-old-space-size from parent execArgv', async () => {
        const worker = loadWorker();
        const child = makeFakeChild();
        forkMock.mockImplementation(() => child);
        const originalArgv = process.execArgv;
        process.execArgv = ['--inspect=9229', '--max-old-space-size=4096', '--enable-source-maps'];
        const runPromise = worker.run({ kind: 'event', payload: {} });
        await flush();
        process.execArgv = originalArgv;

        const forkArgs = forkMock.mock.calls[0];
        const execArgv = forkArgs[2].execArgv;
        expect(execArgv).toContain('--enable-source-maps');
        expect(execArgv.filter((a) => a.startsWith('--inspect'))).toHaveLength(0);
        // Exactly one --max-old-space-size arg (the freshly added one).
        expect(execArgv.filter((a) => a.startsWith('--max-old-space-size='))).toHaveLength(1);

        child.emit('message', { type: 'result', result: 'ok' });
        child.emit('exit', 0, null);
        await runPromise;
    });

    test('rejects if child emits error before any message', async () => {
        const worker = loadWorker();
        const child = makeFakeChild();
        forkMock.mockReturnValue(child);
        const runPromise = worker.run({ kind: 'event', payload: {} });
        await flush();
        child.emit('error', new Error('spawn EACCES'));
        await expect(runPromise).rejects.toThrow('spawn EACCES');
    });
});
