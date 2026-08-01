'use strict';

const net = require('net');
const { Transform } = require('stream');

class ClamAvUnavailableError extends Error {
    constructor(message = 'Malware scanner unavailable') {
        super(message);
        this.name = 'ClamAvUnavailableError';
    }
}
class MalwareDetectedError extends Error {
    constructor(signature) {
        super('Malware detected');
        this.name = 'MalwareDetectedError';
        this.signature = signature;
    }
}

const isEnabled = () => process.env.CLAMAV_ENABLED === 'true';
const getConfig = () => {
    if (!isEnabled()) {return null;}
    const host = process.env.CLAMAV_HOST?.trim();
    const port = Number(process.env.CLAMAV_PORT || 3310);
    const timeoutMs = Number(process.env.CLAMAV_TIMEOUT_MS || 30000);
    if (!host || host.includes('://') || /[/\\@?#]/.test(host)) {throw new Error('CLAMAV_HOST is invalid');}
    if (!Number.isInteger(port) || port < 1 || port > 65535) {throw new Error('CLAMAV_PORT is invalid');}
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 120000) {throw new Error('CLAMAV_TIMEOUT_MS is invalid');}
    return { host, port, timeoutMs };
};

const chunkFramer = () => new Transform({
    transform(chunk, encoding, callback) {
        const size = Buffer.allocUnsafe(4);
        size.writeUInt32BE(chunk.length);
        callback(null, Buffer.concat([size, chunk]));
    },
    flush(callback) {callback(null, Buffer.alloc(4));},
});

const parseResponse = (response) => {
    const value = response.replace(/\0/g, '').trim();
    if (/^stream: OK$/i.test(value)) {return { clean: true };}
    const found = /^stream: (.+) FOUND$/i.exec(value);
    if (found) {throw new MalwareDetectedError(found[1]);}
    throw new ClamAvUnavailableError(`Unexpected clamd response: ${value.slice(0, 120)}`);
};

const scanStream = (source, config = getConfig()) => new Promise((resolve, reject) => {
    if (!config) {return reject(new ClamAvUnavailableError('Malware scanner is disabled'));}
    const socket = net.createConnection({ host: config.host, port: config.port });
    const framer = chunkFramer();
    const chunks = [];
    let responseBytes = 0;
    let settled = false;
    const finish = (error, result) => {
        if (settled) {return;}
        settled = true;
        source.unpipe(framer);
        framer.unpipe(socket);
        socket.destroy();
        if (error) {reject(error);} else {resolve(result);}
    };
    const timer = setTimeout(() => finish(new ClamAvUnavailableError('Malware scan timed out')), config.timeoutMs);
    timer.unref?.();
    const done = (error, result) => {clearTimeout(timer); finish(error, result);};
    socket.once('connect', () => {
        socket.write('zINSTREAM\0');
        source.pipe(framer).pipe(socket, { end: false });
    });
    socket.on('data', (chunk) => {
        responseBytes += chunk.length;
        if (responseBytes > 4096) {return done(new ClamAvUnavailableError('clamd response too large'));}
        chunks.push(chunk);
        if (chunk.includes(0) || chunk.includes(10)) {
            try {done(null, parseResponse(Buffer.concat(chunks).toString('utf8')));} catch (error) {done(error);}
        }
    });
    source.once('error', (error) => done(new ClamAvUnavailableError(error.message)));
    framer.once('error', (error) => done(new ClamAvUnavailableError(error.message)));
    socket.once('error', (error) => done(new ClamAvUnavailableError(error.message)));
    socket.once('end', () => {
        if (!settled) {
            try {done(null, parseResponse(Buffer.concat(chunks).toString('utf8')));} catch (error) {done(error);}
        }
    });
});

module.exports = {
    isEnabled,
    getConfig,
    chunkFramer,
    parseResponse,
    scanStream,
    ClamAvUnavailableError,
    MalwareDetectedError,
};