'use strict';

const {
    fail,
    classifyError,
    isTerminalErrorCode,
    nextRetryDelayFor429,
    nextGenericRetryDelay,
} = require('../raster-ingest.retry');
const { Api400Error } = require('../../core/error.response');

// Silence expected chatter from `fail()` in every test.
const silence = () => {
    const spies = {
        warn: jest.spyOn(console, 'warn').mockImplementation(() => {}),
        error: jest.spyOn(console, 'error').mockImplementation(() => {}),
        info: jest.spyOn(console, 'info').mockImplementation(() => {}),
        debug: jest.spyOn(console, 'debug').mockImplementation(() => {}),
    };
    return () => {
        for (const spy of Object.values(spies)) {spy.mockRestore();}
    };
};

const makeRepo = (overrides = {}) => ({
    updateStatus: jest.fn().mockResolvedValue(undefined),
    incrementRetry: jest.fn().mockResolvedValue(undefined),
    moveToDlq: jest.fn().mockResolvedValue(undefined),
    ...overrides,
});

describe('classifyError', () => {
    test('detects URL expired (HTTP 401 upstream)', () => {
        const err = new Error('HTTP 401 when fetching https://x/y');
        err.code = 'UPSTREAM_4XX';
        expect(classifyError(err)).toMatchObject({ isUrlExpired: true, is429: false });
    });

    test('detects 429 rate limit', () => {
        const err = new Error('HTTP 429 rate-limited');
        err.code = 'UPSTREAM_4XX';
        expect(classifyError(err)).toMatchObject({ is429: true, isUrlExpired: false });
    });

    test('classifies other 4xx as non-retryable', () => {
        const err = new Error('HTTP 403 forbidden');
        err.code = 'UPSTREAM_4XX';
        expect(classifyError(err)).toMatchObject({
            isNonRetryable4xx: true,
            is429: false,
            isUrlExpired: false,
        });
    });

    test('safely handles error objects lacking .code / .message', () => {
        const result = classifyError({});
        expect(result.errMsg).toBe('ERROR: ');
        expect(result.is429).toBe(false);
    });
});

describe('isTerminalErrorCode', () => {
    test('Api400Error is terminal', () => {
        expect(isTerminalErrorCode(new Api400Error('bad request'))).toBe(true);
    });
    test('FILE_TOO_LARGE / NO_TIF_IN_ZIP are terminal', () => {
        expect(isTerminalErrorCode({ code: 'FILE_TOO_LARGE' })).toBe(true);
        expect(isTerminalErrorCode({ code: 'NO_TIF_IN_ZIP' })).toBe(true);
    });
    test('other errors are not terminal by code alone', () => {
        expect(isTerminalErrorCode(new Error('ETIMEDOUT'))).toBe(false);
    });
});

describe('backoff schedules', () => {
    test('nextRetryDelayFor429 follows the calibrated 60s / 180s / 600s schedule (with jitter)', () => {
        for (let attempt = 0; attempt < 4; attempt += 1) {
            const bases = [60_000, 180_000, 600_000, 600_000];
            const d = nextRetryDelayFor429(attempt);
            expect(d).toBeGreaterThanOrEqual(bases[attempt]);
            expect(d).toBeLessThanOrEqual(bases[attempt] * 1.25);
        }
    });

    test('nextGenericRetryDelay doubles per attempt, capped at cfg.RETRY_MAX_MS', () => {
        const d0 = nextGenericRetryDelay(0);
        const d1 = nextGenericRetryDelay(1);
        const d2 = nextGenericRetryDelay(2);
        expect(d1).toBe(d0 * 2);
        expect(d2).toBe(d0 * 4);
        const bigAttempt = nextGenericRetryDelay(30);
        expect(bigAttempt).toBeLessThanOrEqual(120_000); // config cap
    });
});

describe('fail()', () => {
    let unsilence;
    beforeEach(() => {
        unsilence = silence();
    });
    afterEach(() => {
        unsilence();
    });

    test('URL expired → updateStatus("url_expired")', async () => {
        const repo = makeRepo();
        const err = new Error('HTTP 401 UNAUTHENTICATED');
        err.code = 'UPSTREAM_4XX';
        await fail({ id: 1, retry_count: 0, layer_code: 'x' }, err, { repo });
        expect(repo.updateStatus).toHaveBeenCalledWith(1, {
            status: 'url_expired',
            errorLog: expect.stringContaining('UPSTREAM_4XX'),
        });
        expect(repo.incrementRetry).not.toHaveBeenCalled();
    });

    test('retryable transient error under budget → incrementRetry with backoff', async () => {
        const repo = makeRepo();
        const err = new Error('ETIMEDOUT');
        err.code = 'STREAM_ERROR';
        await fail({ id: 2, retry_count: 1, layer_code: 'y' }, err, { repo });
        expect(repo.incrementRetry).toHaveBeenCalledWith(
            2,
            expect.objectContaining({ nextRetryAtMs: expect.any(Number) }),
        );
        expect(repo.updateStatus).not.toHaveBeenCalled();
        expect(repo.moveToDlq).not.toHaveBeenCalled();
    });

    test('429 → incrementRetry with the 60s calibrated delay', async () => {
        const repo = makeRepo();
        const err = new Error('HTTP 429 too many requests');
        err.code = 'UPSTREAM_4XX';
        await fail({ id: 3, retry_count: 0, layer_code: 'z' }, err, { repo });
        const call = repo.incrementRetry.mock.calls[0][1];
        expect(call.nextRetryAtMs).toBeGreaterThanOrEqual(60_000);
        expect(call.nextRetryAtMs).toBeLessThanOrEqual(60_000 * 1.25);
    });

    test('retry budget exhausted → moveToDlq', async () => {
        const repo = makeRepo();
        // Configured MAX_RETRIES default = 3, so retry_count=3 is exhausted.
        const err = new Error('ETIMEDOUT');
        err.code = 'STREAM_ERROR';
        await fail({ id: 4, retry_count: 3, layer_code: 'a' }, err, { repo });
        expect(repo.moveToDlq).toHaveBeenCalledWith(
            4,
            expect.objectContaining({ reason: 'MAX_RETRIES_EXCEEDED' }),
        );
        expect(repo.incrementRetry).not.toHaveBeenCalled();
    });

    test('non-retryable terminal error → moveToDlq(reason=NON_RETRYABLE)', async () => {
        const repo = makeRepo();
        const err = new Error('too big');
        err.code = 'FILE_TOO_LARGE';
        await fail({ id: 5, retry_count: 0, layer_code: 'b' }, err, { repo });
        expect(repo.moveToDlq).toHaveBeenCalledWith(
            5,
            expect.objectContaining({ reason: 'NON_RETRYABLE' }),
        );
    });

    test('falls back to updateStatus("failed") when repo lacks moveToDlq', async () => {
        const repo = makeRepo();
        delete repo.moveToDlq;
        const err = new Error('bad');
        err.code = 'FILE_TOO_LARGE';
        await fail({ id: 6, retry_count: 0, layer_code: 'c' }, err, { repo });
        expect(repo.updateStatus).toHaveBeenCalledWith(6, {
            status: 'failed',
            errorLog: expect.any(String),
        });
    });

    test('logs and returns silently when repo is not yet installed (pre-GEE-S05)', async () => {
        const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
        try {
            await expect(
                fail({ id: 7, retry_count: 0 }, new Error('boom'), { repo: null }),
            ).resolves.toBeUndefined();
            expect(errorSpy).toHaveBeenCalled();
        } finally {
            errorSpy.mockRestore();
        }
    });
});
