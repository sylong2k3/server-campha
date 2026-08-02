'use strict';
process.env.API_SHARE_JWT_SECRET = 's'.repeat(48);
const token = require('../api-share-token.util');
describe('api share token', () => {
    test('uses dedicated claims and rejects user-session JWT', () => {
        const signed = token.sign({
            keyId: '18a19fb0-0bd6-46fa-9318-d52a77a75c51',
            registryId: 7,
            layerId: 9,
            scopes: ['features:read'],
            tokenVersion: 1,
            expiresInSeconds: 60,
        });
        expect(token.verify(signed.token)).toMatchObject({
            type: 'layer_share',
            keyId: '18a19fb0-0bd6-46fa-9318-d52a77a75c51',
            registryId: 7,
            layerId: 9,
            scopes: ['features:read'],
            tokenVersion: 1,
            jti: signed.jti,
        });
        expect(signed.jtiHash).toHaveLength(64);
        expect(signed.token).not.toContain(signed.jti);
    });
    test('fails closed without share secret', () => {
        const value = process.env.API_SHARE_JWT_SECRET;
        delete process.env.API_SHARE_JWT_SECRET;
        expect(() => token.verify('x')).toThrow(/not configured/);
        process.env.API_SHARE_JWT_SECRET = value;
    });
});
