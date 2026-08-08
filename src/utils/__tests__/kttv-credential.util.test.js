'use strict';

const { encryptCredential, decryptCredential, maskCredential } = require('../kttv-credential.util');

describe('kttv credential utility', () => {
    const previous = process.env.KTTV_CREDENTIAL_ENCRYPTION_KEY;

    beforeAll(() => {
        process.env.KTTV_CREDENTIAL_ENCRYPTION_KEY = 'ab'.repeat(32);
    });

    afterAll(() => {
        if (previous === undefined) {
            delete process.env.KTTV_CREDENTIAL_ENCRYPTION_KEY;
        } else {
            process.env.KTTV_CREDENTIAL_ENCRYPTION_KEY = previous;
        }
    });

    test('AES-GCM roundtrip và ciphertext không chứa plaintext', () => {
        const plaintext = JSON.stringify({ apiKey: 'plaintext-secret' });
        const encrypted = encryptCredential(plaintext);
        expect(encrypted.toString('utf8')).not.toContain('plaintext-secret');
        expect(decryptCredential(encrypted)).toBe(plaintext);
    });

    test('mask lấy 4 ký tự cuối secret thật, không lấy đuôi JSON', () => {
        expect(
            maskCredential(encryptCredential(JSON.stringify({ apiKey: 'plaintext-secret' }))),
        ).toBe('****cret');
        expect(
            maskCredential(encryptCredential(JSON.stringify({ token: 'bearer-token-9876' }))),
        ).toBe('****9876');
    });

    test('ciphertext bị sửa không thể giải mã', () => {
        const encrypted = encryptCredential(JSON.stringify({ token: 'secret' }));
        encrypted[encrypted.length - 1] ^= 1;
        expect(() => decryptCredential(encrypted)).toThrow();
    });
});
