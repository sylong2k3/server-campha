const {
    encodeBase32,
    decodeBase32,
    hotp,
    generateTotp,
    verifyTotp,
    encryptSecret,
    decryptSecret,
} = require('../totp.util');

const RFC_SECRET = encodeBase32(Buffer.from('12345678901234567890', 'ascii'));

describe('TOTP utility', () => {
    beforeAll(() => {
        process.env.MFA_ENCRYPTION_KEY = '11'.repeat(32);
    });

    test('Base32 round trip', () => {
        const input = Buffer.from('Cẩm Phả MFA', 'utf8');
        expect(decodeBase32(encodeBase32(input))).toEqual(input);
        expect(() => decodeBase32('not valid!')).toThrow('Invalid Base32');
    });

    test.each([
        [0, '755224'],
        [1, '287082'],
        [2, '359152'],
        [3, '969429'],
        [4, '338314'],
        [5, '254676'],
        [6, '287922'],
        [7, '162583'],
        [8, '399871'],
        [9, '520489'],
    ])('HOTP RFC 4226 counter %i', (counter, expected) => {
        expect(hotp(RFC_SECRET, counter)).toBe(expected);
    });

    test('TOTP accepts current window and rejects malformed code', () => {
        const timeMs = 59_000;
        const code = generateTotp(RFC_SECRET, { timeMs });
        expect(verifyTotp(RFC_SECRET, code, { timeMs })).toBe(1);
        expect(verifyTotp(RFC_SECRET, '12345', { timeMs })).toBeNull();
        expect(verifyTotp(RFC_SECRET, code, { timeMs: timeMs + 90_000 })).toBeNull();
    });

    test('AES-GCM round trip rejects tampering', () => {
        const encrypted = encryptSecret(RFC_SECRET);
        expect(decryptSecret(encrypted)).toBe(RFC_SECRET);
        const tampered = { ...encrypted, ciphertext: `${encrypted.ciphertext.slice(0, -2)}AA` };
        expect(() => decryptSecret(tampered)).toThrow();
    });
});
