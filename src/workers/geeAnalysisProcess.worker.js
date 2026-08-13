'use strict';

/**
 * Fork one Earth Engine analysis into an isolated child process.
 *
 * See @docs/GEE_FLOOD_INTEGRATION_ARCHITECTURE.md §25 for design rationale.
 * The queue's `concurrency=1` gate lives in the HTTP process; the child holds
 * the entire EE graph. When the child exits, the OS reclaims all heap + native
 * buffers, so long-running servers do not accumulate leaked GEE state.
 *
 * Per-kind memory limits (§22-J improvement over reference project). The
 * reference used one global GEE_CHILD_MAX_RSS_MB; we split per kind because
 * Sentinel-1 event graphs run wider than HAND scenarios, and trend graphs
 * (M5, spanning multi-year Sentinel-1) run wider still.
 *
 * @ported-from migration/kt_gee_migration/workers/geeAnalysisProcess.worker.js
 */

const path = require('path');
const { fork } = require('child_process');

const CHILD_PATH = path.resolve(__dirname, 'geeAnalysis.child.js');

const CHILD_MAX_RSS_MB_DEFAULT = Math.max(
    512,
    Number.parseInt(process.env.GEE_CHILD_MAX_RSS_MB, 10) || 2048,
);
// Per-kind override map. Values fall back to the default above if unset.
const PER_KIND_RSS_MB = Object.freeze({
    event: Number.parseInt(process.env.GEE_CHILD_MAX_RSS_MB_EVENT, 10) || 2048,
    hand: Number.parseInt(process.env.GEE_CHILD_MAX_RSS_MB_HAND, 10) || 1024,
    rain: Number.parseInt(process.env.GEE_CHILD_MAX_RSS_MB_RAIN, 10) || 1024,
    impact: Number.parseInt(process.env.GEE_CHILD_MAX_RSS_MB_IMPACT, 10) || 768,
    trend: Number.parseInt(process.env.GEE_CHILD_MAX_RSS_MB_TREND, 10) || 3072,
});

const CHILD_TIMEOUT_MS = Math.max(
    5 * 60 * 1000,
    Number.parseInt(process.env.GEE_CHILD_TIMEOUT_MS, 10) || 30 * 60 * 1000,
);
const MEMORY_LIMIT_SAMPLES = 2;
const KILL_GRACE_MS = 5000;
const CHILD_MEMORY_WARN_PCT = Math.max(
    50,
    Math.min(95, Number.parseInt(process.env.GEE_CHILD_MEMORY_WARN_PCT, 10) || 80),
);

const resolveRssLimit = (kind) => {
    const kindLimit = PER_KIND_RSS_MB[kind];
    return Math.max(512, kindLimit || CHILD_MAX_RSS_MB_DEFAULT);
};

const resolveOldSpaceMb = (rssLimitMb) => {
    const envOverride = Number.parseInt(process.env.GEE_CHILD_MAX_OLD_SPACE_MB, 10);
    const base = envOverride || Math.max(256, rssLimitMb - 128);
    return Math.max(256, Math.min(rssLimitMb - 128, base));
};

/**
 * Spawn a child process, run one analysis, resolve with its result, and let
 * the OS reclaim the child's memory.
 *
 * @param {object} opts
 * @param {'event'|'hand'|'rain'|'impact'|'trend'} opts.kind
 * @param {object} opts.payload — passed to the domain module's runAnalysis()
 * @returns {Promise<any>} result returned by the domain module
 */
const run = ({ kind, payload } = {}) =>
    new Promise((resolve, reject) => {
        const startedAt = Date.now();
        const rssLimitMb = resolveRssLimit(kind);
        const oldSpaceMb = resolveOldSpaceMb(rssLimitMb);
        const execArgv = process.execArgv
            .filter(
                (arg) => !arg.startsWith('--inspect') && !arg.startsWith('--max-old-space-size'),
            )
            .concat(`--max-old-space-size=${oldSpaceMb}`);

        const child = fork(CHILD_PATH, [], {
            cwd: path.resolve(__dirname, '../..'),
            env: {
                ...process.env,
                GEE_ANALYSIS_CHILD: 'true',
            },
            stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
            windowsHide: true,
            execArgv,
        });

        let response = null;
        let spawnError = null;
        let watchdogError = null;
        let settled = false;
        let overMemorySamples = 0;
        let forceKillTimer = null;
        let peakRssBytes = 0;
        let peakHeapUsedBytes = 0;
        let memoryWarningLogged = false;

        const clearWatchdogs = () => {
            clearTimeout(timeoutTimer);
            if (forceKillTimer) {
                clearTimeout(forceKillTimer);
            }
        };

        const terminate = (error) => {
            if (watchdogError) {
                return;
            }
            watchdogError = error;
            console.error(
                `[GEE-CHILD] terminating kind=${kind} pid=${child.pid || '-'}: ${error.message}`,
            );
            child.kill('SIGTERM');
            forceKillTimer = setTimeout(() => {
                if (child.exitCode === null && child.signalCode === null) {
                    console.error(`[GEE-CHILD] force kill kind=${kind} pid=${child.pid || '-'}`);
                    child.kill('SIGKILL');
                }
            }, KILL_GRACE_MS);
            forceKillTimer.unref();
        };

        const timeoutTimer = setTimeout(() => {
            const error = new Error(
                `GEE child exceeded timeout ${Math.round(CHILD_TIMEOUT_MS / 60000)} minutes.`,
            );
            error.code = 'GEE_CHILD_TIMEOUT';
            terminate(error);
        }, CHILD_TIMEOUT_MS);
        timeoutTimer.unref();

        child.on('message', (message) => {
            if (message?.type === 'memory') {
                const rssBytes = Number(message.rss) || 0;
                const rssMb = rssBytes / (1024 * 1024);
                const heapUsedBytes = Number(message.heapUsed) || 0;
                peakRssBytes = Math.max(peakRssBytes, rssBytes);
                peakHeapUsedBytes = Math.max(peakHeapUsedBytes, heapUsedBytes);
                if (!memoryWarningLogged && rssMb >= rssLimitMb * (CHILD_MEMORY_WARN_PCT / 100)) {
                    memoryWarningLogged = true;
                    console.warn(
                        `[GEE-CHILD] memory warning kind=${kind} pid=${child.pid || '-'} ` +
                            `rss=${rssMb.toFixed(0)}MB (${CHILD_MEMORY_WARN_PCT}% of ${rssLimitMb}MB) ` +
                            `heapUsed=${(heapUsedBytes / (1024 * 1024)).toFixed(0)}MB`,
                    );
                }
                overMemorySamples = rssMb > rssLimitMb ? overMemorySamples + 1 : 0;
                if (overMemorySamples >= MEMORY_LIMIT_SAMPLES) {
                    const error = new Error(
                        `GEE child RSS ${rssMb.toFixed(0)}MB exceeded ${rssLimitMb}MB limit for kind=${kind}.`,
                    );
                    error.code = 'GEE_CHILD_MEMORY_LIMIT';
                    terminate(error);
                }
                return;
            }
            if (message?.type === 'result' || message?.type === 'error') {
                response = message;
            }
        });

        child.once('error', (error) => {
            spawnError = error;
            if (!watchdogError && !settled) {
                settled = true;
                clearWatchdogs();
                reject(error);
            }
        });

        child.once('exit', (code, signal) => {
            clearWatchdogs();
            console.info(
                `[GEE-CHILD] exited kind=${kind} pid=${child.pid || '-'} ` +
                    `code=${code ?? 'null'} signal=${signal || 'none'} ` +
                    `peakRss=${(peakRssBytes / (1024 * 1024)).toFixed(0)}MB ` +
                    `peakHeap=${(peakHeapUsedBytes / (1024 * 1024)).toFixed(0)}MB ` +
                    `elapsed=${Date.now() - startedAt}ms`,
            );
            if (settled) {
                return;
            }
            settled = true;
            if (watchdogError) {
                return reject(watchdogError);
            }
            if (spawnError) {
                return reject(spawnError);
            }
            if (response?.type === 'result' && code === 0) {
                return resolve(response.result);
            }
            const detail =
                response?.error ||
                `GEE child exited code=${code ?? 'null'} signal=${signal || 'none'}`;
            const error = new Error(detail);
            if (response?.stack) {
                error.stack = response.stack;
            }
            if (response?.code) {
                error.code = response.code;
            }
            reject(error);
        });

        console.info(
            `[GEE-CHILD] spawned kind=${kind} pid=${child.pid || '-'} ` +
                `heapLimit=${oldSpaceMb}MB rssLimit=${rssLimitMb}MB ` +
                `timeout=${Math.round(CHILD_TIMEOUT_MS / 60000)}m`,
        );
        child.send({ kind, payload }, (error) => {
            if (!error) {
                return;
            }
            error.code = error.code || 'GEE_CHILD_IPC_SEND_FAILED';
            terminate(error);
        });
    });

module.exports = {
    run,
    // Exposed for tests + admin diagnostics.
    resolveRssLimit,
    resolveOldSpaceMb,
    PER_KIND_RSS_MB,
    CHILD_MAX_RSS_MB_DEFAULT,
    CHILD_TIMEOUT_MS,
};
