'use strict';

const path = require('path');

const load = (env = {}) => {
    const original = {};
    for (const [key, value] of Object.entries(env)) {
        original[key] = process.env[key];
        if (value === undefined) {
            delete process.env[key];
        } else {
            process.env[key] = String(value);
        }
    }
    try {
        // Jest's own module registry needs an explicit reset; delete
        // require.cache alone doesn't clear it.
        jest.resetModules();
        return require('../raster-ingest');
    } finally {
        for (const key of Object.keys(env)) {
            if (original[key] === undefined) {
                delete process.env[key];
            } else {
                process.env[key] = original[key];
            }
        }
    }
};

describe('configs/raster-ingest', () => {
    test('defaults are safe (disabled, 3GB max, 15min timeout, retries=3)', () => {
        const cfg = load({
            RASTER_INGEST_ENABLED: undefined,
            RASTER_INGEST_MAX_MB: undefined,
            RASTER_INGEST_FETCH_TIMEOUT_MS: undefined,
            RASTER_INGEST_MAX_RETRIES: undefined,
        });
        expect(cfg.ENABLED).toBe(false);
        expect(cfg.MAX_BYTES).toBe(3072 * 1024 * 1024);
        expect(cfg.FETCH_TIMEOUT_MS).toBe(900_000);
        expect(cfg.MAX_RETRIES).toBe(3);
        expect(cfg.RETRY_BASE_MS).toBe(15_000);
        expect(cfg.RETRY_MAX_MS).toBe(120_000);
        expect(cfg.CONCURRENCY).toBe(1);
    });

    test('CONCURRENCY is hard-clamped to 1 even when env raises the requested value', () => {
        const cfg = load({ RASTER_INGEST_CONCURRENCY: 8 });
        expect(cfg.CONCURRENCY).toBe(1);
        expect(cfg.REQUESTED_CONCURRENCY).toBe(8);
    });

    test('TMP_DIR default lives under the OS tmpdir with a namespaced folder', () => {
        const cfg = load({ RASTER_INGEST_TMP_DIR: undefined });
        expect(path.basename(cfg.TMP_DIR)).toBe('campha_raster_ingest');
    });

    test('TMP_DIR honours an explicit env override', () => {
        const cfg = load({ RASTER_INGEST_TMP_DIR: '/mnt/data/ingest' });
        expect(cfg.TMP_DIR).toBe('/mnt/data/ingest');
    });

    test('summariseConfig exposes all knobs for admin diagnostics', () => {
        const cfg = load();
        const summary = cfg.summariseConfig();
        for (const key of [
            'enabled',
            'tmpDir',
            'maxBytes',
            'fetchTimeoutMs',
            'maxRetries',
            'retryBaseMs',
            'retryMaxMs',
            'concurrency',
            'requestedConcurrency',
            'gdalCacheMaxMb',
            'workerPollCron',
        ]) {
            expect(summary).toHaveProperty(key);
        }
    });

    test('isEnabled() reads env at call time (not module-load time)', () => {
        const cfg = load();
        const previous = process.env.RASTER_INGEST_ENABLED;
        try {
            process.env.RASTER_INGEST_ENABLED = 'true';
            expect(cfg.isEnabled()).toBe(true);
            process.env.RASTER_INGEST_ENABLED = 'false';
            expect(cfg.isEnabled()).toBe(false);
        } finally {
            if (previous === undefined) {
                delete process.env.RASTER_INGEST_ENABLED;
            } else {
                process.env.RASTER_INGEST_ENABLED = previous;
            }
        }
    });

    test('ENABLED constant reflects the boot-time env (module-load snapshot)', () => {
        expect(load({ RASTER_INGEST_ENABLED: 'true' }).ENABLED).toBe(true);
        expect(load({ RASTER_INGEST_ENABLED: 'false' }).ENABLED).toBe(false);
    });
});
