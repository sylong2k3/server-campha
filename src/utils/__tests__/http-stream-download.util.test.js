'use strict';

const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { downloadToFile, DownloadError, safeUrlWithoutQuery } = require('../http-stream-download.util');

/**
 * Spin up a real localhost HTTP server per-test. Simpler than mocking global
 * fetch and better exercises the streaming code path (Readable.fromWeb).
 */
const startServer = (handler) =>
    new Promise((resolve) => {
        const server = http.createServer(handler);
        server.listen(0, '127.0.0.1', () => {
            const { port } = server.address();
            resolve({
                url: `http://127.0.0.1:${port}`,
                close: () => new Promise((r) => server.close(r)),
            });
        });
    });

describe('http-stream-download.util', () => {
    let tmpDir;

    beforeAll(async () => {
        tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'http-stream-test-'));
    });

    afterAll(async () => {
        await fs.promises.rm(tmpDir, { recursive: true, force: true });
    });

    test('downloads a small payload, reports byte count + sha256 + content type', async () => {
        const payload = Buffer.from('the quick brown fox jumps over the lazy dog');
        const expectedSha256 = crypto.createHash('sha256').update(payload).digest('hex');

        const server = await startServer((_req, res) => {
            res.writeHead(200, {
                'Content-Type': 'application/octet-stream',
                'Content-Length': payload.length,
            });
            res.end(payload);
        });

        try {
            const dest = path.join(tmpDir, 'ok.bin');
            const result = await downloadToFile(`${server.url}/x`, dest, {
                timeoutMs: 5000,
                maxBytes: 10_000,
            });
            expect(result.bytes).toBe(payload.length);
            expect(result.sha256).toBe(expectedSha256);
            expect(result.contentType).toBe('application/octet-stream');
            const written = await fs.promises.readFile(dest);
            expect(written.equals(payload)).toBe(true);
        } finally {
            await server.close();
        }
    });

    test('throws FILE_TOO_LARGE (from Content-Length) without opening the connection body', async () => {
        const server = await startServer((_req, res) => {
            res.writeHead(200, { 'Content-Length': '1000000' });
            res.end('a'.repeat(1000000));
        });

        try {
            const dest = path.join(tmpDir, 'too-big.bin');
            const err = await downloadToFile(`${server.url}/big`, dest, {
                timeoutMs: 5000,
                maxBytes: 10,
            }).then(
                () => null,
                (e) => e,
            );
            expect(err).toBeInstanceOf(DownloadError);
            expect(err.code).toBe('FILE_TOO_LARGE');
            await expect(fs.promises.stat(dest)).rejects.toThrow();
        } finally {
            await server.close();
        }
    });

    test('throws FILE_TOO_LARGE (mid-stream, when server does not send Content-Length)', async () => {
        const server = await startServer((_req, res) => {
            // No Content-Length — chunked or streaming.
            res.writeHead(200);
            // Send many small chunks so the meter has to catch the overflow.
            let count = 0;
            const iv = setInterval(() => {
                res.write('a'.repeat(1024));
                count += 1;
                if (count >= 20) {
                    clearInterval(iv);
                    res.end();
                }
            }, 5);
        });

        try {
            const dest = path.join(tmpDir, 'stream-too-big.bin');
            const err = await downloadToFile(`${server.url}/stream`, dest, {
                timeoutMs: 5000,
                maxBytes: 4096,
            }).then(
                () => null,
                (e) => e,
            );
            expect(err).toBeInstanceOf(DownloadError);
            expect(err.code).toBe('FILE_TOO_LARGE');
        } finally {
            await server.close();
        }
    });

    test('classifies HTTP 404 as UPSTREAM_4XX', async () => {
        const server = await startServer((_req, res) => {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('not here');
        });

        try {
            const dest = path.join(tmpDir, 'nope.bin');
            const err = await downloadToFile(`${server.url}/nope`, dest, {
                timeoutMs: 5000,
                maxBytes: 10_000,
            }).then(
                () => null,
                (e) => e,
            );
            expect(err).toBeInstanceOf(DownloadError);
            expect(err.code).toBe('UPSTREAM_4XX');
        } finally {
            await server.close();
        }
    });

    test('classifies HTTP 503 as UPSTREAM_5XX', async () => {
        const server = await startServer((_req, res) => {
            res.writeHead(503);
            res.end('down');
        });

        try {
            const dest = path.join(tmpDir, 'down.bin');
            const err = await downloadToFile(`${server.url}/x`, dest, {
                timeoutMs: 5000,
                maxBytes: 10_000,
            }).then(
                () => null,
                (e) => e,
            );
            expect(err).toBeInstanceOf(DownloadError);
            expect(err.code).toBe('UPSTREAM_5XX');
        } finally {
            await server.close();
        }
    });

    test('throws BAD_ARG when timeout or maxBytes is missing / invalid', async () => {
        const dest = path.join(tmpDir, 'noop.bin');
        await expect(
            downloadToFile('http://example.invalid', dest, { maxBytes: 100 }),
        ).rejects.toMatchObject({ code: 'BAD_ARG' });
        await expect(
            downloadToFile('http://example.invalid', dest, { timeoutMs: 100 }),
        ).rejects.toMatchObject({ code: 'BAD_ARG' });
    });

    test('safeUrlWithoutQuery strips the query string from URLs', () => {
        expect(safeUrlWithoutQuery('https://x.example/path?token=SECRET&y=1')).toBe(
            'https://x.example/path',
        );
        expect(safeUrlWithoutQuery('not-a-url')).toBe('(invalid-url)');
    });
});
