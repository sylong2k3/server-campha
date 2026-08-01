const crypto = require('crypto');

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const TOTP_PERIOD_SECONDS = 30;
const TOTP_DIGITS = 6;

const encodeBase32 = (buffer) => {
    let bits = 0;
    let value = 0;
    let output = '';
    for (const byte of buffer) {
        value = (value << 8) | byte;
        bits += 8;
        while (bits >= 5) {
            output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
            bits -= 5;
        }
    }
    if (bits > 0) {
        output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
    }
    return output;
};

const decodeBase32 = (value) => {
    const normalized = String(value).toUpperCase().replace(/=+$/g, '');
    if (!normalized || !/^[A-Z2-7]+$/.test(normalized)) {
        throw new Error('Invalid Base32 value');
    }
    let bits = 0;
    let current = 0;
    const bytes = [];
    for (const char of normalized) {
        current = (current << 5) | BASE32_ALPHABET.indexOf(char);
        bits += 5;
        if (bits >= 8) {
            bytes.push((current >>> (bits - 8)) & 255);
            bits -= 8;
        }
    }
    return Buffer.from(bytes);
};

const hotp = (secret, counter, digits = TOTP_DIGITS, algorithm = 'sha1') => {
    if (!Number.isSafeInteger(counter) || counter < 0) {
        throw new Error('HOTP counter must be a non-negative safe integer');
    }
    const counterBuffer = Buffer.alloc(8);
    counterBuffer.writeBigUInt64BE(BigInt(counter));
    const digest = crypto.createHmac(algorithm, decodeBase32(secret)).update(counterBuffer).digest();
    const offset = digest[digest.length - 1] & 0x0f;
    const binary = (digest.readUInt32BE(offset) & 0x7fffffff) % (10 ** digits);
    return String(binary).padStart(digits, '0');
};

const counterAt = (timeMs = Date.now(), period = TOTP_PERIOD_SECONDS) =>
    Math.floor(timeMs / 1000 / period);

const generateTotp = (secret, options = {}) => hotp(
    secret,
    options.counter ?? counterAt(options.timeMs, options.period),
    options.digits || TOTP_DIGITS,
    options.algorithm || 'sha1'
);

const verifyTotp = (secret, token, options = {}) => {
    if (!/^\d{6}$/.test(String(token))) {
        return null;
    }
    const current = counterAt(options.timeMs, options.period);
    const window = options.window ?? 1;
    for (let offset = -window; offset <= window; offset += 1) {
        const counter = current + offset;
        if (counter >= 0 && crypto.timingSafeEqual(
            Buffer.from(generateTotp(secret, { ...options, counter })),
            Buffer.from(String(token))
        )) {
            return counter;
        }
    }
    return null;
};

const createSecret = (bytes = 20) => encodeBase32(crypto.randomBytes(bytes));

const buildOtpAuthUri = ({ secret, account, issuer = 'Cam Pha GIS' }) => {
    const label = `${issuer}:${account}`;
    const params = new URLSearchParams({
        secret,
        issuer,
        algorithm: 'SHA1',
        digits: String(TOTP_DIGITS),
        period: String(TOTP_PERIOD_SECONDS),
    });
    return `otpauth://totp/${encodeURIComponent(label)}?${params}`;
};

const getEncryptionKey = () => {
    const key = process.env.MFA_ENCRYPTION_KEY;
    if (!key || !/^[a-fA-F0-9]{64}$/.test(key)) {
        throw new Error('MFA_ENCRYPTION_KEY must be a 64-character hex value');
    }
    return Buffer.from(key, 'hex');
};

const encryptSecret = (secret) => {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', getEncryptionKey(), iv);
    const ciphertext = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
    return {
        ciphertext: ciphertext.toString('base64'),
        iv: iv.toString('hex'),
        authTag: cipher.getAuthTag().toString('hex'),
    };
};

const decryptSecret = ({ ciphertext, iv, authTag }) => {
    const decipher = crypto.createDecipheriv('aes-256-gcm', getEncryptionKey(), Buffer.from(iv, 'hex'));
    decipher.setAuthTag(Buffer.from(authTag, 'hex'));
    return Buffer.concat([
        decipher.update(Buffer.from(ciphertext, 'base64')),
        decipher.final(),
    ]).toString('utf8');
};

module.exports = {
    encodeBase32,
    decodeBase32,
    hotp,
    generateTotp,
    verifyTotp,
    createSecret,
    buildOtpAuthUri,
    encryptSecret,
    decryptSecret,
};
