'use strict';

/**
 * Mã hóa/giải mã credential cho kttv.sources (US-10a.2).
 *
 * Schema chỉ có 1 cột `credential_enc BYTEA` (theo đúng docs/KE_HOACH_XAY_DUNG_HE_THONG.md),
 * nên đóng gói iv(12 byte) + authTag(16 byte) + ciphertext vào cùng 1 buffer thay vì
 * tách 3 cột như auth.device_tokens. Cùng thuật toán AES-256-GCM đã dùng cho device token.
 */

const crypto = require('crypto');

const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

const getKey = () => {
    const raw = process.env.KTTV_CREDENTIAL_ENCRYPTION_KEY;
    if (!/^[a-f0-9]{64}$/i.test(raw || '')) {
        throw new Error('KTTV_CREDENTIAL_ENCRYPTION_KEY must be a 64-character hex value');
    }
    return Buffer.from(raw, 'hex');
};

/** @param {string} plaintext @returns {Buffer} */
const encryptCredential = (plaintext) => {
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv('aes-256-gcm', getKey(), iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]);
};

/** @param {Buffer} packed @returns {string} */
const decryptCredential = (packed) => {
    const buf = Buffer.isBuffer(packed) ? packed : Buffer.from(packed);
    const iv = buf.subarray(0, IV_LENGTH);
    const authTag = buf.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
    const ciphertext = buf.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
    const decipher = crypto.createDecipheriv('aes-256-gcm', getKey(), iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
};

/**
 * Chỉ hiển thị 4 ký tự cuối — kể cả với TNMT (docs mục "Bảo mật — trọng tâm của sprint này").
 * @param {Buffer|null} packed
 */
const maskCredential = (packed) => {
    if (!packed) {
        return null;
    }
    const plaintext = decryptCredential(packed);
    return plaintext.length <= 4 ? '****' : `****${plaintext.slice(-4)}`;
};

module.exports = { encryptCredential, decryptCredential, maskCredential };
