'use strict';
const db = require('../configs/database');
const { versionCondition } = require('../utils/optimistic-lock.util');
const pageResult = (rows) => ({
    items: rows.map(({ total_count: _total, ...row }) => row),
    total: rows[0]?.total_count || 0,
});
const publicFields = `r.id,r.reference_code,r.description,r.status,ST_X(r.location) longitude,ST_Y(r.location) latitude,CASE WHEN r.measured_geometry IS NULL THEN NULL ELSE ST_AsGeoJSON(r.measured_geometry)::jsonb END measured_geometry,r.created_at,r.updated_at,(SELECT COUNT(*)::int FROM community.field_report_photos p WHERE p.report_id=r.id) photo_count`;
const privateFields = `${publicFields},r.sender_user_id,r.org_id,r.review_reason,r.reviewed_by,r.reviewed_at,u.full_name sender_name,u.email sender_email`;
const paginate = (params, page, limit) => {
    params.push(limit, (page - 1) * limit);
    return `LIMIT $${params.length - 1} OFFSET $${params.length}`;
};
const list = async (filter, mode, actor) => {
    const params = [],
        where = ['r.deleted_at IS NULL'];
    let fields = privateFields,
        join = 'JOIN auth.users u ON u.id=r.sender_user_id';
    if (mode === 'public') {
        fields = publicFields;
        join = '';
        where.push("r.status IN('approved','resolved')");
    } else if (mode === 'mine') {
        params.push(actor.id);
        where.push(`r.sender_user_id=$${params.length}`);
    }
    if (filter.status) {
        params.push(filter.status);
        where.push(`r.status=$${params.length}`);
    }
    const paging = paginate(params, filter.page, filter.limit);
    const { rows } = await db.query(
        `SELECT ${fields},COUNT(*) OVER()::int total_count FROM community.field_reports r ${join} WHERE ${where.join(' AND ')} ORDER BY r.created_at DESC,r.id DESC ${paging}`,
        params,
    );
    return pageResult(rows);
};
const find = async (id, mode, actor = null, client = db) => {
    const params = [id],
        where = ['r.id=$1', 'r.deleted_at IS NULL'];
    let fields = privateFields,
        join = 'JOIN auth.users u ON u.id=r.sender_user_id';
    if (mode === 'public') {
        fields = publicFields;
        join = '';
        where.push("r.status IN('approved','resolved')");
    }
    if (mode === 'mine') {
        params.push(actor.id);
        where.push(`r.sender_user_id=$${params.length}`);
    }
    const {
        rows: [row],
    } = await client.query(
        `SELECT ${fields} FROM community.field_reports r ${join} WHERE ${where.join(' AND ')}`,
        params,
    );
    return row || null;
};
const assertPhotos = async (client, ids, ownerId) => {
    if (!ids.length) {
        return [];
    }
    const { rows } = await client.query(
        `SELECT id FROM core.file_objects WHERE id=ANY($1::bigint[]) AND owner_user_id=$2 AND category='field-photos' AND lifecycle_status='ready' AND scan_status='clean' AND detected_mime IN('image/png','image/webp') AND deleted_at IS NULL`,
        [ids, ownerId],
    );
    return rows.map((row) => Number(row.id));
};
const create = async (input, actor) => {
    const client = await db.getClient();
    try {
        await client.query('BEGIN');
        const photoIds = await assertPhotos(client, input.photoIds, actor.id);
        if (photoIds.length !== input.photoIds.length) {
            await client.query('ROLLBACK');
            return null;
        }
        const measured = input.measuredGeometry ? JSON.stringify(input.measuredGeometry) : null;
        const {
            rows: [row],
        } = await client.query(
            `INSERT INTO community.field_reports(sender_user_id,org_id,description,location,measured_geometry) VALUES($1,$2,$3,ST_SetSRID(ST_MakePoint($4,$5),4326),CASE WHEN $6::jsonb IS NULL THEN NULL ELSE ST_SetSRID(ST_GeomFromGeoJSON($6::jsonb),4326) END) RETURNING *`,
            [
                actor.id,
                actor.orgId || null,
                input.description,
                input.longitude,
                input.latitude,
                measured,
            ],
        );
        const referenceCode = `CP-${new Date().getUTCFullYear()}-${String(row.id).padStart(8, '0')}`;
        await client.query('UPDATE community.field_reports SET reference_code=$2 WHERE id=$1', [
            row.id,
            referenceCode,
        ]);
        for (let i = 0; i < photoIds.length; i++) {
            await client.query(
                'INSERT INTO community.field_report_photos(report_id,file_object_id,sort_order) VALUES($1,$2,$3)',
                [row.id, photoIds[i], i + 1],
            );
        }
        await client.query(
            `INSERT INTO community.field_report_status_history(report_id,new_status,actor_user_id) VALUES($1,'pending',$2)`,
            [row.id, actor.id],
        );
        await client.query('COMMIT');
        return find(row.id, 'mine', actor);
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
};
const review = async (id, input, actor) => {
    const client = await db.getClient();
    try {
        await client.query('BEGIN');
        const {
            rows: [current],
        } = await client.query(
            'SELECT status FROM community.field_reports WHERE id=$1 AND deleted_at IS NULL FOR UPDATE',
            [id],
        );
        if (!current) {
            await client.query('ROLLBACK');
            return null;
        }
        const version = versionCondition(5, 'r.updated_at');
        const {
            rows: [row],
        } = await client.query(
            `UPDATE community.field_reports r SET status=$2,review_reason=$3,reviewed_by=$4,reviewed_at=NOW() WHERE id=$1 AND deleted_at IS NULL${version} RETURNING *`,
            [id, input.status, input.reason || null, actor.id, input.expectedUpdatedAt],
        );
        if (!row) {
            await client.query('ROLLBACK');
            return null;
        }
        await client.query(
            `INSERT INTO community.field_report_status_history(report_id,previous_status,new_status,reason,actor_user_id) VALUES($1,$2,$3,$4,$5)`,
            [id, current.status, input.status, input.reason || null, actor.id],
        );
        await client.query('COMMIT');
        return find(id, 'admin', actor);
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
};
const remove = async (id, expectedUpdatedAt, actor) => {
    const client = await db.getClient();
    try {
        await client.query('BEGIN');
        const version = versionCondition(3, 'r.updated_at');
        const {
            rows: [row],
        } = await client.query(
            `UPDATE community.field_reports r SET deleted_at=NOW() WHERE id=$1 AND sender_user_id=$2 AND deleted_at IS NULL${version} RETURNING id`,
            [id, actor.id, expectedUpdatedAt],
        );
        if (row) {
            await client.query('COMMIT');
            return row;
        }
        const {
            rows: [deleted],
        } = await client.query(
            'SELECT id FROM community.field_reports WHERE id=$1 AND sender_user_id=$2 AND deleted_at IS NOT NULL',
            [id, actor.id],
        );
        await client.query(deleted ? 'COMMIT' : 'ROLLBACK');
        return deleted || null;
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
};
const history = async (id) => {
    const { rows } = await db.query(
        `SELECT previous_status,new_status,reason,actor_user_id,created_at FROM community.field_report_status_history WHERE report_id=$1 ORDER BY created_at,id`,
        [id],
    );
    return rows;
};
const nearby = async (input) => {
    const params = [input.longitude, input.latitude, input.radiusMeters, input.from, input.to];
    const scope = `x.deleted_at IS NULL AND x.status IN('approved','resolved') AND x.created_at BETWEEN $4 AND $5 AND ST_DWithin(ST_Transform(x.location,5899),ST_Transform(ST_SetSRID(ST_MakePoint($1,$2),4326),5899),$3)`;
    const { rows } = await db.query(
        `SELECT ${publicFields},(SELECT COUNT(DISTINCT x.sender_user_id)::int FROM community.field_reports x WHERE ${scope}) distinct_reporters FROM community.field_reports r WHERE r.deleted_at IS NULL AND r.status IN('approved','resolved') AND r.created_at BETWEEN $4 AND $5 AND ST_DWithin(ST_Transform(r.location,5899),ST_Transform(ST_SetSRID(ST_MakePoint($1,$2),4326),5899),$3) ORDER BY r.created_at DESC LIMIT 100`,
        params,
    );
    return rows;
};
const clusters = async (input) => {
    const { rows } = await db.query(
        `WITH base AS(SELECT id,sender_user_id,ST_Transform(location,5899) geom FROM community.field_reports WHERE deleted_at IS NULL AND created_at BETWEEN $1 AND $2),marked AS(SELECT *,ST_ClusterDBSCAN(geom,eps:=$3,minpoints:=$4) OVER() cluster_id FROM base) SELECT cluster_id,COUNT(*)::int report_count,COUNT(DISTINCT sender_user_id)::int reporter_count,ST_X(ST_Transform(ST_Centroid(ST_Collect(geom)),4326)) longitude,ST_Y(ST_Transform(ST_Centroid(ST_Collect(geom)),4326)) latitude FROM marked WHERE cluster_id IS NOT NULL GROUP BY cluster_id HAVING COUNT(DISTINCT sender_user_id)>=$4 ORDER BY reporter_count DESC,cluster_id LIMIT 200`,
        [input.from, input.to, input.radiusMeters, input.minReporters],
    );
    return rows;
};
const photoObjects = async (id) => {
    const { rows } = await db.query(
        `SELECT f.id,f.object_key,f.original_name,f.detected_mime,f.size_bytes FROM community.field_report_photos p JOIN core.file_objects f ON f.id=p.file_object_id WHERE p.report_id=$1 AND f.lifecycle_status='ready' ORDER BY p.sort_order`,
        [id],
    );
    return rows;
};
const markPhotoDeleted = async (fileId, ownerId) => {
    const {
        rows: [row],
    } = await db.query(
        `UPDATE core.file_objects SET lifecycle_status='deleted',deleted_at=NOW() WHERE id=$1 AND owner_user_id=$2 AND lifecycle_status='ready' RETURNING id`,
        [fileId, ownerId],
    );
    return row || null;
};
const eventSummary = async (id) => {
    const {
        rows: [row],
    } = await db.query(
        `SELECT id,reference_code,sender_user_id,status,created_at,updated_at FROM community.field_reports WHERE id=$1 AND deleted_at IS NULL`,
        [id],
    );
    return row || null;
};
module.exports = {
    list,
    find,
    create,
    review,
    remove,
    history,
    nearby,
    clusters,
    photoObjects,
    markPhotoDeleted,
    eventSummary,
    assertPhotos,
};
