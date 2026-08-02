'use strict';
const jwt = require('jsonwebtoken');
const { generateUUID } = require('./cryptoHelper.util');
const { hashToken } = require('./cryptoHelper.util');
const ALGORITHM = process.env.JWT_ALGORITHM || 'HS256',
    ISSUER = 'campha-api-registry',
    AUDIENCE = 'campha-shared-layer';
const secret = () => {
    const value = process.env.API_SHARE_JWT_SECRET;
    if (!value || value.length < 32) {
        throw new Error('API_SHARE_JWT_SECRET is not configured');
    }
    return value;
};
const sign = ({ keyId, registryId, layerId, scopes, tokenVersion, expiresInSeconds }) => {
    const jti = generateUUID();
    const token = jwt.sign(
        { type: 'layer_share', keyId, registryId, layerId, scopes, tokenVersion, jti },
        secret(),
        { algorithm: ALGORITHM, issuer: ISSUER, audience: AUDIENCE, expiresIn: expiresInSeconds },
    );
    const decoded = jwt.decode(token);
    return {
        token,
        jti,
        jtiHash: hashToken(jti),
        tokenHint: token.slice(-8),
        expiresAt: new Date(decoded.exp * 1000),
    };
};
const verify = (token) =>
    jwt.verify(token, secret(), { algorithms: [ALGORITHM], issuer: ISSUER, audience: AUDIENCE });
module.exports = { sign, verify, ISSUER, AUDIENCE };
