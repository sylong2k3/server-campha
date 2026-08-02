'use strict';
const { Readable } = require('stream');
const {
    chunkFramer,
    parseResponse,
    MalwareDetectedError,
    ClamAvUnavailableError,
} = require('../clamav.service');
const collect = async (stream) => {
    const chunks = [];
    for await (const chunk of stream) {
        chunks.push(chunk);
    }
    return Buffer.concat(chunks);
};
describe('ClamAV INSTREAM framing', () => {
    test('frames chunks with uint32 length and zero terminator', async () => {
        const framed = await collect(Readable.from([Buffer.from('abc')]).pipe(chunkFramer()));
        expect(framed.subarray(0, 4).readUInt32BE()).toBe(3);
        expect(framed.subarray(4, 7).toString()).toBe('abc');
        expect(framed.subarray(7).equals(Buffer.alloc(4))).toBe(true);
    });
    test('classifies clean, malware and unknown responses', () => {
        expect(parseResponse('stream: OK\0')).toEqual({ clean: true });
        expect(() => parseResponse('stream: Eicar-Signature FOUND\0')).toThrow(
            MalwareDetectedError,
        );
        expect(() => parseResponse('stream: size limit exceeded ERROR\0')).toThrow(
            ClamAvUnavailableError,
        );
    });
    test('validates enabled scanner configuration', () => {
        const original = process.env;
        process.env = {
            ...original,
            CLAMAV_ENABLED: 'true',
            CLAMAV_HOST: 'http://bad',
            CLAMAV_PORT: '3310',
            CLAMAV_TIMEOUT_MS: '30000',
        };
        expect(() => require('../clamav.service').getConfig()).toThrow('CLAMAV_HOST');
        process.env.CLAMAV_HOST = '127.0.0.1';
        process.env.CLAMAV_PORT = '0';
        expect(() => require('../clamav.service').getConfig()).toThrow('CLAMAV_PORT');
        process.env.CLAMAV_PORT = '3310';
        process.env.CLAMAV_TIMEOUT_MS = '1';
        expect(() => require('../clamav.service').getConfig()).toThrow('CLAMAV_TIMEOUT_MS');
        process.env = original;
    });
    test('fails closed when scanner is disabled', async () => {
        await expect(
            require('../clamav.service').scanStream(Readable.from('x'), null),
        ).rejects.toBeInstanceOf(ClamAvUnavailableError);
    });
    test('scans clean stream through clamd TCP protocol', async () => {
        const net = require('net');
        const server = net.createServer((socket) =>
            socket.once('data', () => socket.end('stream: OK\0')),
        );
        await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
        try {
            const port = server.address().port;
            await expect(
                require('../clamav.service').scanStream(Readable.from('payload'), {
                    host: '127.0.0.1',
                    port,
                    timeoutMs: 2000,
                }),
            ).resolves.toEqual({ clean: true });
        } finally {
            await new Promise((resolve) => server.close(resolve));
        }
    });
});
