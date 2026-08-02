'use strict';
const repository = require('../device-token.repository');
describe('Sprint 8 device token encryption', () => {
    beforeEach(() => {
        process.env.DEVICE_TOKEN_ENCRYPTION_KEY = 'ab'.repeat(32);
    });
    test('AES-GCM roundtrip and deterministic hash', () => {
        const token = 'token-'.padEnd(64, 'x'),
            encrypted = repository.encrypt(token);
        expect(encrypted.ciphertext).not.toContain(token);
        expect(
            repository.decrypt({
                token_ciphertext: encrypted.ciphertext,
                token_iv: encrypted.iv,
                token_auth_tag: encrypted.authTag,
            }),
        ).toBe(token);
        expect(repository.hash(token)).toHaveLength(64);
    });
    test('rejects missing encryption key', () => {
        delete process.env.DEVICE_TOKEN_ENCRYPTION_KEY;
        expect(() => repository.encrypt('x'.repeat(64))).toThrow(/64-character/);
    });
});
