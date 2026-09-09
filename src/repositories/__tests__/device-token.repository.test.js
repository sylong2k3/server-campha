'use strict';
jest.mock('../../configs/database', () => ({ query: jest.fn(), getClient: jest.fn() }));
const db = require('../../configs/database');
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
    test('rejects truncated GCM authentication tags', () => {
        const encrypted = repository.encrypt('x'.repeat(64));
        expect(() =>
            repository.decrypt({
                token_ciphertext: encrypted.ciphertext,
                token_iv: encrypted.iv,
                token_auth_tag: encrypted.authTag.slice(0, -2),
            }),
        ).toThrow();
    });
    test('rejects missing encryption key', () => {
        delete process.env.DEVICE_TOKEN_ENCRYPTION_KEY;
        expect(() => repository.encrypt('x'.repeat(64))).toThrow(/64-character/);
    });
    test('loads active tokens for a unique user set', async () => {
        const encrypted = repository.encrypt('token-one');
        db.query.mockResolvedValue({
            rows: [
                {
                    user_id: 7,
                    token_ciphertext: encrypted.ciphertext,
                    token_iv: encrypted.iv,
                    token_auth_tag: encrypted.authTag,
                },
            ],
        });
        await expect(repository.activeForUsers([7, 7])).resolves.toEqual([
            { userId: 7, token: 'token-one' },
        ]);
        expect(db.query.mock.calls[0][1]).toEqual([[7]]);
    });
    test('counts active tokens for health status', async () => {
        db.query.mockResolvedValue({ rows: [{ total: 3 }] });
        await expect(repository.countActive()).resolves.toBe(3);
        expect(db.query.mock.calls[0][0]).toMatch(/disabled_at IS NULL/);
    });
});
