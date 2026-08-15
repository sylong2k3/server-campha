'use strict';
const db = require('../configs/database');
const { randomUUID } = require('crypto');
const tokenUtil = require('../utils/api-share-token.util');
const publicKey = (row, token) => {
    const safe = { ...row };
    delete safe.jti_hash;
    return { ...safe, token };
};
const SORT = {
    created_at: 'r.created_at',
    updated_at: 'r.updated_at',
    name: 'r.name',
    slug: 'r.slug',
};
const list = async (filter) => {
    const p = [],
        where = ['r.deleted_at IS NULL'];
    if (filter.q) {
        p.push(`%${filter.q}%`);
        where.push(`(r.name ILIKE $${p.length} OR r.slug ILIKE $${p.length})`);
    }
    // Accept isActive (camelCase) OR is_active (snake) so admin callers wired
    // to the DB column name still work.
    const isActiveFilter = filter.isActive ?? filter.is_active;
    if (typeof isActiveFilter === 'boolean') {
        p.push(isActiveFilter);
        where.push(`r.is_active = $${p.length}`);
    }
    const layerIdFilter = filter.layerId ?? filter.layer_id;
    if (Number.isFinite(Number(layerIdFilter))) {
        p.push(Number(layerIdFilter));
        where.push(`r.layer_id = $${p.length}`);
    }
    p.push(filter.limit, (filter.page - 1) * filter.limit);
    const sort = SORT[filter.sortBy] || SORT.created_at,
        order = filter.sortOrder === 'ASC' ? 'ASC' : 'DESC';
    const { rows } = await db.query(
        `SELECT r.*,l.code layer_code,l.name_vi layer_name,COUNT(*) OVER()::int total_count FROM apikey.registries r JOIN gis.layers l ON l.id=r.layer_id WHERE ${where.join(' AND ')} ORDER BY ${sort} ${order},r.id ${order} LIMIT $${p.length - 1} OFFSET $${p.length}`,
        p,
    );
    return {
        items: rows.map(({ total_count: _total, ...x }) => x),
        total: rows[0]?.total_count || 0,
    };
};
const find = async (id, client = db) => {
    const {
        rows: [row],
    } = await client.query(
        `SELECT r.*,l.code layer_code,l.name_vi layer_name,l.table_name,l.storage_kind,l.geometry_type,l.srid,l.metadata,l.publish_status,l.deleted_at layer_deleted FROM apikey.registries r JOIN gis.layers l ON l.id=r.layer_id WHERE r.id=$1 AND r.deleted_at IS NULL`,
        [id],
    );
    return row || null;
};
const layer = async (id, client = db) => {
    const {
        rows: [row],
    } = await client.query(`SELECT * FROM gis.layers WHERE id=$1 AND deleted_at IS NULL`, [id]);
    return row || null;
};
const columns = async (table) => {
    const { rows } = await db.query(
        `SELECT column_name FROM information_schema.columns WHERE table_schema='gis' AND table_name=$1`,
        [table],
    );
    return rows.map((x) => x.column_name);
};
const create = async (input, actor) => {
    const {
        rows: [row],
    } = await db.query(
        `INSERT INTO apikey.registries(layer_id,slug,name,read_fields,write_fields,search_fields,allowed_methods,default_sort_field,created_by,updated_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$9) RETURNING *`,
        [
            input.layerId,
            input.slug,
            input.name,
            input.readFields,
            input.writeFields,
            input.searchFields,
            input.allowedMethods,
            input.defaultSortField,
            actor.id,
        ],
    );
    return row;
};
const update = async (id, input, actor) => {
    const map = {
            name: 'name',
            readFields: 'read_fields',
            writeFields: 'write_fields',
            searchFields: 'search_fields',
            allowedMethods: 'allowed_methods',
            defaultSortField: 'default_sort_field',
            isActive: 'is_active',
        },
        p = [],
        set = [];
    for (const [key, column] of Object.entries(map)) {
        if (Object.hasOwn(input, key)) {
            p.push(input[key]);
            set.push(`${column}=$${p.length}`);
        }
    }
    p.push(actor.id, id, input.expectedVersion);
    const {
        rows: [row],
    } = await db.query(
        `UPDATE apikey.registries SET ${set.join(',')},updated_by=$${p.length - 2},version=version+1 WHERE id=$${p.length - 1} AND version=$${p.length} AND deleted_at IS NULL RETURNING *`,
        p,
    );
    return row || null;
};
const remove = async (id, version, actor) => {
    const client = await db.getClient();
    try {
        await client.query('BEGIN');
        const {
            rows: [row],
        } = await client.query(
            `UPDATE apikey.registries SET deleted_at=NOW(),is_active=false,updated_by=$3,version=version+1 WHERE id=$1 AND version=$2 AND deleted_at IS NULL RETURNING *`,
            [id, version, actor.id],
        );
        if (!row) {
            await client.query('ROLLBACK');
            return null;
        }
        const { rows: keys } = await client.query(
            `UPDATE apikey.keys SET revoked_at=COALESCE(revoked_at,NOW()),revoked_by=COALESCE(revoked_by,$2) WHERE registry_id=$1 AND revoked_at IS NULL RETURNING id`,
            [id, actor.id],
        );
        for (const key of keys) {
            await client.query(
                `INSERT INTO apikey.key_events(key_id,event,actor_user_id,metadata) VALUES($1,'revoked',$2,$3)`,
                [key.id, actor.id, { reason: 'registry_deleted' }],
            );
        }
        await client.query('COMMIT');
        return row;
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
};
const keys = async (registryId) => {
    const { rows } = await db.query(
        `SELECT id,registry_id,name,consumer,token_version,token_hint,scopes,quota_per_minute,expires_at,created_by,approved_by,created_at,rotated_at,revoked_at FROM apikey.keys WHERE registry_id=$1 ORDER BY created_at DESC`,
        [registryId],
    );
    return rows;
};
const issue = async (registry, input, actor) => {
    const client = await db.getClient();
    try {
        await client.query('BEGIN');
        const keyId = randomUUID(),
            expiresInSeconds = input.expiresInHours * 3600,
            signed = tokenUtil.sign({
                keyId,
                registryId: registry.id,
                layerId: registry.layer_id,
                scopes: input.scopes,
                tokenVersion: 1,
                expiresInSeconds,
            });
        const approvedBy = input.scopes.some((x) => x !== 'features:read') ? actor.id : null;
        const {
            rows: [row],
        } = await client.query(
            `INSERT INTO apikey.keys(id,registry_id,name,consumer,jti_hash,token_hint,scopes,quota_per_minute,expires_at,created_by,approved_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
            [
                keyId,
                registry.id,
                input.name,
                input.consumer,
                signed.jtiHash,
                signed.tokenHint,
                input.scopes,
                input.quotaPerMinute,
                signed.expiresAt,
                actor.id,
                approvedBy,
            ],
        );
        await client.query(
            `INSERT INTO apikey.key_events(key_id,event,actor_user_id,metadata) VALUES($1,'issued',$2,$3)`,
            [keyId, actor.id, { scopes: input.scopes, expiresAt: signed.expiresAt }],
        );
        await client.query('COMMIT');
        return publicKey(row, signed.token);
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
};
const key = async (id) => {
    const {
        rows: [row],
    } = await db.query(
        `SELECT k.*,r.layer_id,r.allowed_methods,r.deleted_at registry_deleted FROM apikey.keys k JOIN apikey.registries r ON r.id=k.registry_id WHERE k.id=$1`,
        [id],
    );
    return row || null;
};
const revoke = async (id, actor) => {
    const client = await db.getClient();
    try {
        await client.query('BEGIN');
        const {
            rows: [row],
        } = await client.query(
            `UPDATE apikey.keys SET revoked_at=NOW(),revoked_by=$2 WHERE id=$1 AND revoked_at IS NULL RETURNING *`,
            [id, actor.id],
        );
        if (row) {
            await client.query(
                `INSERT INTO apikey.key_events(key_id,event,actor_user_id) VALUES($1,'revoked',$2)`,
                [id, actor.id],
            );
        }
        await client.query('COMMIT');
        return row ? publicKey(row) : null;
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
};
const rotate = async (current, hours, actor) => {
    const client = await db.getClient();
    try {
        await client.query('BEGIN');
        const next = current.token_version + 1,
            signed = tokenUtil.sign({
                keyId: current.id,
                registryId: current.registry_id,
                layerId: current.layer_id,
                scopes: current.scopes,
                tokenVersion: next,
                expiresInSeconds: hours * 3600,
            });
        const {
            rows: [row],
        } = await client.query(
            `UPDATE apikey.keys SET token_version=$2,jti_hash=$3,token_hint=$4,expires_at=$5,rotated_at=NOW(),rotated_by=$6,revoked_at=NULL,revoked_by=NULL WHERE id=$1 RETURNING *`,
            [current.id, next, signed.jtiHash, signed.tokenHint, signed.expiresAt, actor.id],
        );
        await client.query(
            `INSERT INTO apikey.key_events(key_id,event,actor_user_id,metadata) VALUES($1,'rotated',$2,$3)`,
            [current.id, actor.id, { tokenVersion: next, expiresAt: signed.expiresAt }],
        );
        await client.query('COMMIT');
        return publicKey(row, signed.token);
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
};
const usage = async (registryId, from, to) => {
    const p = [registryId],
        where = ['registry_id=$1'];
    if (from) {
        p.push(from);
        where.push(`created_at>=$${p.length}`);
    }
    if (to) {
        p.push(to);
        where.push(`created_at<=$${p.length}`);
    }
    const {
        rows: [summary],
    } = await db.query(
        `SELECT COUNT(*)::int calls,COUNT(*) FILTER(WHERE status_code=429)::int quota_rejections,COUNT(*) FILTER(WHERE status_code>=400)::int errors,COALESCE(ROUND(AVG(duration_ms)::numeric,2),0) avg_duration_ms FROM apikey.call_logs WHERE ${where.join(' AND ')}`,
        p,
    );
    const { rows: byKey } = await db.query(
        `SELECT key_id,COUNT(*)::int calls,MAX(created_at) last_called_at FROM apikey.call_logs WHERE ${where.join(' AND ')} GROUP BY key_id ORDER BY calls DESC`,
        p,
    );
    return { summary, byKey };
};
module.exports = {
    list,
    find,
    layer,
    columns,
    create,
    update,
    remove,
    keys,
    issue,
    key,
    revoke,
    rotate,
    usage,
};
