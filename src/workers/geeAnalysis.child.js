'use strict';

/**
 * Child process entry point for a single Earth Engine flood analysis.
 *
 * The parent (`workers/geeAnalysisProcess.worker.js`) forks this file, sends
 * one `{ kind, payload }` message, and expects one `{ type: 'result' | 'error', ... }`
 * reply before the child exits. On exit the OS reclaims the entire heap +
 * native buffers — the whole reason child isolation exists (see
 * @docs/GEE_FLOOD_INTEGRATION_ARCHITECTURE.md §25).
 *
 * Every 5 seconds (configurable) the child posts a `{ type: 'memory', ... }`
 * heartbeat so the parent can enforce RSS limits.
 *
 * @ported-from migration/kt_gee_migration/workers/geeAnalysis.child.js
 * @security IPC never carries the GEE service key. The child receives only
 *           process.env (which contains GEE_KEY_PATH — a path, not contents)
 *           and loads the key via fs on demand from configs/gge.js.
 */

process.env.TZ = process.env.TZ || 'Asia/Ho_Chi_Minh';
process.env.DOTENV_CONFIG_QUIET = process.env.DOTENV_CONFIG_QUIET || 'true';
require('dotenv').config({ quiet: true });

const db = require('../configs/database');
const runExecutor = require('../services/flood/run-executor.service');
const SUPPORTED_KINDS = Object.freeze(['event', 'hand', 'rain', 'impact', 'trend', 'forecast']);

let received = false;
const MEMORY_HEARTBEAT_MS = Math.max(
    1000,
    Number.parseInt(process.env.GEE_CHILD_MEMORY_HEARTBEAT_MS, 10) || 5000,
);
const memoryHeartbeat = setInterval(() => {
    if (typeof process.send !== 'function' || !process.connected) {
        return;
    }
    const memory = process.memoryUsage();
    process.send(
        {
            type: 'memory',
            rss: memory.rss,
            heapTotal: memory.heapTotal,
            heapUsed: memory.heapUsed,
            external: memory.external,
            arrayBuffers: memory.arrayBuffers,
        },
        () => {},
    );
}, MEMORY_HEARTBEAT_MS);
memoryHeartbeat.unref();

const sendAndExit = (message, code) => {
    clearInterval(memoryHeartbeat);
    if (typeof process.send !== 'function') {
        process.exit(code);
        return;
    }
    process.send(message, () => process.exit(code));
};

process.once('message', async ({ kind, payload } = {}) => {
    if (received) {
        return;
    }
    received = true;

    try {
        if (!SUPPORTED_KINDS.includes(kind)) {
            throw new Error(
                `Unsupported GEE child job kind: ${kind || '(empty)'}. ` +
                    `Expected one of ${SUPPORTED_KINDS.join(', ')}.`,
            );
        }
        const result = await runExecutor.executePersistedRun(payload || {});
        await db.pool.end();
        sendAndExit({ type: 'result', result }, 0);
    } catch (error) {
        try {
            await db.pool.end();
        } catch (cleanupError) {
            console.warn(`[GEE-CHILD] cleanup failed: ${cleanupError.message}`);
        }
        sendAndExit(
            {
                type: 'error',
                error: error.message,
                stack: error.stack,
                code: error.code,
            },
            1,
        );
    }
});

process.on('disconnect', () => {
    console.warn('[GEE-CHILD] Parent IPC disconnected; terminating worker.');
    process.exit(1);
});
