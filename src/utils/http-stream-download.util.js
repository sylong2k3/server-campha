'use strict';

/**
 * Stream one URL down to disk with:
 *   - AbortController timeout on the whole transfer
 *   - Hard-abort when byte count exceeds `maxBytes` (does not drain the stream)
 *   - SHA-256 computed inline during streaming (single-pass — no second read)
 *   - Returns the actual byte count read
 *
 * @ported-from migration/kt_gee_migration/utils/http-stream-download.util.js
 * @improvement §22-G — checksum computed during streaming instead of a
 *              separate post-download read pass.
 * @security Query string is stripped from all log lines (`safeUrlWithoutQuery`)
 *           so GEE-signed access tokens never end up in logs.
 */

const fs = require('fs');
const crypto = require('crypto');
const { pipeline } = require('stream/promises');
const { Readable, Transform } = require('stream');

const DEBUG =
    process.env.RASTER_INGEST_DEBUG === 'true' || process.env.NODE_ENV === 'development';

const dbg = (msg) => {
    if (DEBUG) {console.debug(`[HTTP-STREAM] ${msg}`);}
};

const safeHost = (url) => {
    try {
        return new URL(url).host;
    } catch {
        return '(invalid-url)';
    }
};

const safeUrlWithoutQuery = (url) => {
    try {
        const u = new URL(url);
        return `${u.origin}${u.pathname}`;
    } catch {
        return '(invalid-url)';
    }
};

class DownloadError extends Error {
    constructor(message, code, cause) {
        super(message);
        this.name = 'DownloadError';
        this.code = code;
        this.cause = cause;
    }
}

/**
 * @param {string} url
 * @param {string} destPath
 * @param {object} opts
 * @param {number} opts.timeoutMs
 * @param {number} opts.maxBytes
 * @param {object} [opts.headers]
 * @returns {Promise<{bytes: number, contentType: string, sha256: string}>}
 */
async function downloadToFile(url, destPath, { timeoutMs, maxBytes, headers = {} } = {}) {
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
        throw new DownloadError('timeoutMs is required (> 0)', 'BAD_ARG');
    }
    if (!Number.isFinite(maxBytes) || maxBytes <= 0) {
        throw new DownloadError('maxBytes is required (> 0)', 'BAD_ARG');
    }

    const t0 = Date.now();
    const host = safeHost(url);
    dbg(`fetch host=${host} dest=${destPath} timeout=${timeoutMs}ms maxBytes=${maxBytes}`);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    let bytesRead = 0;
    let nextProgressLog = 10 * 1024 * 1024;
    const hasher = crypto.createHash('sha256');

    try {
        const res = await fetch(url, { signal: controller.signal, headers });
        dbg(`response status=${res.status} elapsed=${Date.now() - t0}ms`);

        if (!res.ok) {
            let detail = '';
            try {
                const text = await res.text();
                detail = text ? ` — ${text.replace(/\s+/g, ' ').trim().slice(0, 500)}` : '';
            } catch {
                /* body drain errors are non-fatal here */
            }
            throw new DownloadError(
                `HTTP ${res.status} when fetching ${safeUrlWithoutQuery(url)}${detail}`,
                res.status >= 500 ? 'UPSTREAM_5XX' : 'UPSTREAM_4XX',
            );
        }

        const declared = Number(res.headers.get('content-length') || 0);
        if (declared > 0) {dbg(`content-length declared=${declared} bytes`);}
        if (declared > 0 && declared > maxBytes) {
            throw new DownloadError(
                `File too large: ${declared} bytes > limit ${maxBytes}`,
                'FILE_TOO_LARGE',
            );
        }

        const meter = new Transform({
            transform(chunk, _enc, cb) {
                bytesRead += chunk.length;
                if (bytesRead > maxBytes) {
                    cb(
                        new DownloadError(
                            `File too large: ${bytesRead} bytes > limit ${maxBytes}`,
                            'FILE_TOO_LARGE',
                        ),
                    );
                    return;
                }
                hasher.update(chunk);
                if (DEBUG && bytesRead >= nextProgressLog) {
                    console.debug(
                        `[HTTP-STREAM] progress ${(bytesRead / 1048576).toFixed(1)}MB (${Date.now() - t0}ms)`,
                    );
                    nextProgressLog += 10 * 1024 * 1024;
                }
                cb(null, chunk);
            },
        });

        const src =
            res.body && typeof res.body.getReader === 'function'
                ? Readable.fromWeb(res.body)
                : res.body;

        await pipeline(src, meter, fs.createWriteStream(destPath));

        const contentType = res.headers.get('content-type') || 'application/octet-stream';
        const sha256 = hasher.digest('hex');
        dbg(
            `done bytes=${bytesRead} contentType=${contentType} sha256=${sha256.slice(0, 12)}… elapsed=${Date.now() - t0}ms`,
        );

        return { bytes: bytesRead, contentType, sha256 };
    } catch (err) {
        // Best-effort cleanup of partial writes.
        fs.promises.unlink(destPath).catch(() => {});
        if (err.name === 'AbortError') {
            dbg(`TIMEOUT after ${timeoutMs}ms host=${host}`);
            throw new DownloadError(`Timeout ${timeoutMs}ms while fetching URL`, 'TIMEOUT', err);
        }
        if (err instanceof DownloadError) {
            dbg(`FAIL ${err.code} host=${host} bytesRead=${bytesRead}: ${err.message}`);
            throw err;
        }
        dbg(`STREAM ERROR host=${host} bytesRead=${bytesRead}: ${err.message}`);
        throw new DownloadError(err.message, 'STREAM_ERROR', err);
    } finally {
        clearTimeout(timer);
    }
}

module.exports = { downloadToFile, DownloadError, safeUrlWithoutQuery };
