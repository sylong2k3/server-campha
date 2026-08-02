'use strict';
const db = require('../configs/database');
const { Api401Error, Api403Error, Api429Error } = require('../core/error.response');
const tokenUtil = require('../utils/api-share-token.util');
const hash = require('../utils/cryptoHelper.util').hashToken;
const METHOD_SCOPE = {
    GET: 'features:read',
    POST: 'features:create',
    PUT: 'features:update',
    DELETE: 'features:delete',
};
const bearer = (req) => {
    const value = req.get('authorization') || '';
    const match = value.match(/^Bearer ([^\s]+)$/i);
    return match?.[1];
};
const authenticate = async (req, res, next) => {
    try {
        const token = bearer(req);
        if (!token) {
            throw new Api401Error('Thiếu khóa chia sẻ', ['SHARE_TOKEN_REQUIRED']);
        }
        let payload;
        try {
            payload = tokenUtil.verify(token);
        } catch {
            throw new Api401Error('Khóa chia sẻ không hợp lệ hoặc đã hết hạn', [
                'INVALID_SHARE_TOKEN',
            ]);
        }
        if (payload.type !== 'layer_share' || !payload.keyId || !payload.jti) {
            throw new Api401Error('Khóa chia sẻ không hợp lệ', ['INVALID_SHARE_TOKEN']);
        }
        const {
            rows: [credential],
        } = await db.query(
            `SELECT k.*,r.slug,r.layer_id,r.is_active registry_active,r.deleted_at registry_deleted,r.allowed_methods,r.read_fields,r.write_fields,r.search_fields,r.default_sort_field,r.version registry_version,l.table_name,l.storage_kind,l.geometry_type,l.srid,l.metadata,l.publish_status,l.deleted_at layer_deleted FROM apikey.keys k JOIN apikey.registries r ON r.id=k.registry_id JOIN gis.layers l ON l.id=r.layer_id WHERE k.id=$1`,
            [payload.keyId],
        );
        if (
            !credential ||
            credential.revoked_at ||
            new Date(credential.expires_at) <= new Date() ||
            !credential.registry_active ||
            credential.registry_deleted ||
            credential.layer_deleted ||
            credential.publish_status !== 'published'
        ) {
            throw new Api401Error('Khóa chia sẻ đã bị thu hồi hoặc hết hạn', [
                'SHARE_TOKEN_REVOKED',
            ]);
        }
        const claimScopes = Array.isArray(payload.scopes)
            ? [...payload.scopes].sort().join(',')
            : '';
        if (
            Number(payload.tokenVersion) !== credential.token_version ||
            hash(payload.jti) !== credential.jti_hash ||
            Number(payload.registryId) !== Number(credential.registry_id) ||
            Number(payload.layerId) !== Number(credential.layer_id) ||
            claimScopes !== [...credential.scopes].sort().join(',')
        ) {
            throw new Api401Error('Khóa chia sẻ đã bị thu hồi hoặc xoay vòng', [
                'SHARE_TOKEN_REVOKED',
            ]);
        }
        req.share = { ...credential, scopes: credential.scopes };
        req.shareStarted = Date.now();
        res.on('finish', () => {
            db.query(
                `INSERT INTO apikey.call_logs(registry_id,key_id,method,path,status_code,duration_ms,ip_address,user_agent,row_count) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
                [
                    req.share.registry_id,
                    req.share.id,
                    req.method,
                    req.originalUrl.slice(0, 500),
                    res.statusCode,
                    Math.max(0, Date.now() - req.shareStarted),
                    req.ip,
                    req.get('user-agent')?.slice(0, 500) || null,
                    res.locals.sharedRowCount ?? null,
                ],
            ).catch(() => {});
        });
        const {
            rows: [quota],
        } = await db.query(
            `INSERT INTO apikey.quota_windows(key_id,window_start,request_count) VALUES($1,date_trunc('minute',NOW()),1) ON CONFLICT(key_id,window_start) DO UPDATE SET request_count=apikey.quota_windows.request_count+1 RETURNING request_count,window_start`,
            [credential.id],
        );
        const reset = Math.floor((new Date(quota.window_start).getTime() + 60000) / 1000);
        req.shareQuota = {
            limit: credential.quota_per_minute,
            remaining: Math.max(0, credential.quota_per_minute - quota.request_count),
            reset,
        };
        res.set('RateLimit-Limit', String(req.shareQuota.limit));
        res.set('RateLimit-Remaining', String(req.shareQuota.remaining));
        res.set('RateLimit-Reset', String(req.shareQuota.reset));
        if (quota.request_count > credential.quota_per_minute) {
            throw new Api429Error('Đã vượt hạn mức khóa chia sẻ', ['SHARE_QUOTA_EXCEEDED']);
        }
        const scope = METHOD_SCOPE[req.method];
        if (
            !scope ||
            !credential.scopes.includes(scope) ||
            !credential.allowed_methods.includes(req.method)
        ) {
            throw new Api403Error('Khóa không có scope cho thao tác này', [
                'SHARE_SCOPE_FORBIDDEN',
            ]);
        }
        next();
    } catch (error) {
        next(error);
    }
};
module.exports = { authenticate, METHOD_SCOPE };
