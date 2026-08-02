'use strict';

const db = require('../configs/database');
const { versionCondition } = require('../utils/optimistic-lock.util');

const pageResult = (rows) => ({
    items: rows.map(({ total_count: _total, ...row }) => row),
    total: rows[0]?.total_count || 0,
});
const searchCondition = (column, q, params, conditions) => {
    if (!q) {
        return;
    }
    params.push(`%${q}%`);
    conditions.push(`unaccent(lower(${column})) ILIKE unaccent(lower($${params.length}))`);
};
const paginate = (params, page, limit) => {
    params.push(limit, (page - 1) * limit);
    return `LIMIT $${params.length - 1} OFFSET $${params.length}`;
};

const listNews = async (filter, publicOnly) => {
    const conditions = ['deleted_at IS NULL'];
    const params = [];
    if (publicOnly) {
        conditions.push("status = 'published'", "visibility = 'public'", 'published_at <= NOW()');
    } else {
        if (filter.status) {
            params.push(filter.status);
            conditions.push(`status = $${params.length}`);
        }
        if (filter.visibility) {
            params.push(filter.visibility);
            conditions.push(`visibility = $${params.length}`);
        }
    }
    searchCondition('title', filter.q, params, conditions);
    const paging = paginate(params, filter.page, filter.limit);
    const { rows } = await db.query(
        `SELECT id,title,summary,visibility,status,published_at,created_by,created_at,updated_at,
                COUNT(*) OVER()::int total_count
         FROM cms.news WHERE ${conditions.join(' AND ')}
         ORDER BY COALESCE(published_at,created_at) DESC,id DESC ${paging}`,
        params,
    );
    return pageResult(rows);
};
const findNews = async (id, publicOnly) => {
    const publicSql = publicOnly
        ? "AND status='published' AND visibility='public' AND published_at <= NOW()"
        : '';
    const {
        rows: [row],
    } = await db.query(
        `SELECT id,title,summary,content,visibility,status,published_at,created_by,created_at,updated_at
         FROM cms.news WHERE id=$1 AND deleted_at IS NULL ${publicSql}`,
        [id],
    );
    return row || null;
};
const createNews = async (input, actorId) => {
    const {
        rows: [row],
    } = await db.query(
        `INSERT INTO cms.news(title,summary,content,visibility,status,published_at,created_by,updated_by)
         VALUES($1,$2,$3,$4,$5::varchar,CASE WHEN $5::varchar='published' THEN COALESCE($6::timestamptz,NOW()) ELSE $6::timestamptz END,$7,$7)
         RETURNING *`,
        [
            input.title,
            input.summary || null,
            input.content,
            input.visibility,
            input.status,
            input.publishedAt || null,
            actorId,
        ],
    );
    return row;
};
const updateNews = async (id, input, actorId) => {
    const sets = [];
    const params = [];
    const fields = {
        title: 'title',
        summary: 'summary',
        content: 'content',
        visibility: 'visibility',
        status: 'status',
        publishedAt: 'published_at',
    };
    for (const [key, column] of Object.entries(fields)) {
        if (input[key] !== undefined) {
            params.push(input[key] === '' ? null : input[key]);
            sets.push(`${column}=$${params.length}`);
        }
    }
    if (input.status === 'published' && input.publishedAt === undefined) {
        sets.push('published_at=COALESCE(published_at,NOW())');
    }
    params.push(actorId);
    sets.push(`updated_by=$${params.length}`);
    params.push(id);
    const idIndex = params.length;
    params.push(input.expectedUpdatedAt);
    const version = versionCondition(params.length);
    const {
        rows: [row],
    } = await db.query(
        `UPDATE cms.news SET ${sets.join(',')} WHERE id=$${idIndex}
         AND deleted_at IS NULL ${version} RETURNING *`,
        params,
    );
    return row || null;
};
const deleteNews = async (id, expectedUpdatedAt) => {
    const params = [id, expectedUpdatedAt];
    const version = versionCondition(2);
    const {
        rows: [row],
    } = await db.query(
        `UPDATE cms.news SET deleted_at=NOW() WHERE id=$1 AND deleted_at IS NULL ${version} RETURNING id`,
        params,
    );
    return row || null;
};

const listComments = async (newsId, filter, publicOnly) => {
    const params = [newsId];
    const conditions = ['c.news_id=$1'];
    if (publicOnly) {
        conditions.push(
            "c.status='approved'",
            "n.status='published'",
            "n.visibility='public'",
            'n.deleted_at IS NULL',
        );
    } else if (filter.status) {
        params.push(filter.status);
        conditions.push(`c.status=$${params.length}`);
    }
    const paging = paginate(params, filter.page, filter.limit);
    const { rows } = await db.query(
        `SELECT c.id,c.news_id,c.user_id,u.full_name,c.content,c.status,c.moderated_by,c.moderated_at,c.created_at,
                COUNT(*) OVER()::int total_count
         FROM cms.news_comments c JOIN cms.news n ON n.id=c.news_id JOIN auth.users u ON u.id=c.user_id
         WHERE ${conditions.join(' AND ')} ORDER BY c.created_at,c.id ${paging}`,
        params,
    );
    return pageResult(rows);
};
const createComment = async (newsId, content, userId) => {
    const {
        rows: [row],
    } = await db.query(
        `INSERT INTO cms.news_comments(news_id,user_id,content)
         SELECT id,$2,$3 FROM cms.news
         WHERE id=$1 AND deleted_at IS NULL AND status='published' AND visibility='public' AND published_at <= NOW()
         RETURNING *`,
        [newsId, userId, content],
    );
    return row || null;
};
const moderateComment = async (commentId, status, actorId) => {
    const {
        rows: [row],
    } = await db.query(
        `UPDATE cms.news_comments SET status=$2,moderated_by=$3,moderated_at=NOW()
         WHERE id=$1 RETURNING *`,
        [commentId, status, actorId],
    );
    return row || null;
};

const contentAccess = (mode, alias = 'x') =>
    mode === 'public' ? `${alias}.visibility='public'` : 'TRUE';
const listDocuments = async (filter, mode) => {
    const params = [];
    const conditions = [
        'd.deleted_at IS NULL',
        contentAccess(mode, 'd'),
        "f.lifecycle_status='ready'",
    ];
    if (mode === 'admin' && filter.visibility) {
        params.push(filter.visibility);
        conditions.push(`d.visibility=$${params.length}`);
    }
    if (filter.q) {
        params.push(`%${filter.q}%`);
        conditions.push(
            `(unaccent(lower(d.title)) ILIKE unaccent(lower($${params.length})) OR unaccent(lower(d.document_code)) ILIKE unaccent(lower($${params.length})))`,
        );
    }
    const paging = paginate(params, filter.page, filter.limit);
    const { rows } = await db.query(
        `SELECT d.id,d.title,d.document_code,d.issuing_agency,d.issued_at,d.description,d.visibility,
                f.original_name,f.size_bytes,d.created_at,d.updated_at,COUNT(*) OVER()::int total_count
         FROM cms.documents d JOIN core.file_objects f ON f.id=d.file_object_id
         WHERE ${conditions.join(' AND ')} ORDER BY d.issued_at DESC NULLS LAST,d.id DESC ${paging}`,
        params,
    );
    return pageResult(rows);
};
const findDocument = async (id, mode, includeObject = false) => {
    const internal = includeObject ? ',f.object_key' : '';
    const {
        rows: [row],
    } = await db.query(
        `SELECT d.id,d.title,d.document_code,d.issuing_agency,d.issued_at,d.description,d.visibility,
                f.original_name,f.size_bytes,d.created_at,d.updated_at${internal}
         FROM cms.documents d JOIN core.file_objects f ON f.id=d.file_object_id
         WHERE d.id=$1 AND d.deleted_at IS NULL AND f.lifecycle_status='ready' AND ${contentAccess(mode, 'd')}`,
        [id],
    );
    return row || null;
};
const createDocument = async (input, actorId) => {
    const {
        rows: [row],
    } = await db.query(
        `INSERT INTO cms.documents(title,document_code,issuing_agency,issued_at,description,visibility,file_object_id,created_by)
         SELECT $1,$2,$3,$4,$5,$6,f.id,$8 FROM core.file_objects f
         WHERE f.id=$7 AND f.owner_user_id=$8 AND f.category='documents' AND f.lifecycle_status='ready'
           AND lower(f.original_name) ~ '\\.(pdf|doc|docx|xml)$'
         RETURNING *`,
        [
            input.title,
            input.documentCode,
            input.issuingAgency,
            input.issuedAt || null,
            input.description || null,
            input.visibility,
            input.fileObjectId,
            actorId,
        ],
    );
    return row || null;
};
const deleteDocument = async (id, expectedUpdatedAt) => {
    const params = [id, expectedUpdatedAt];
    const version = versionCondition(2);
    const {
        rows: [row],
    } = await db.query(
        `UPDATE cms.documents SET deleted_at=NOW() WHERE id=$1 AND deleted_at IS NULL ${version} RETURNING id`,
        params,
    );
    return row || null;
};

const listPdfMaps = async (filter, mode) => {
    const params = [];
    const conditions = [
        'm.deleted_at IS NULL',
        contentAccess(mode, 'm'),
        "f.lifecycle_status='ready'",
    ];
    if (mode === 'admin' && filter.visibility) {
        params.push(filter.visibility);
        conditions.push(`m.visibility=$${params.length}`);
    }
    searchCondition('m.title', filter.q, params, conditions);
    const paging = paginate(params, filter.page, filter.limit);
    const { rows } = await db.query(
        `SELECT m.id,m.title,m.scale_label,m.map_year,m.preparing_agency,m.description,m.visibility,
                f.original_name,f.size_bytes,m.created_at,m.updated_at,COUNT(*) OVER()::int total_count
         FROM cms.pdf_maps m JOIN core.file_objects f ON f.id=m.file_object_id
         WHERE ${conditions.join(' AND ')} ORDER BY m.map_year DESC,m.id DESC ${paging}`,
        params,
    );
    return pageResult(rows);
};
const findPdfMap = async (id, mode, includeObject = false) => {
    const internal = includeObject ? ',f.object_key' : '';
    const {
        rows: [row],
    } = await db.query(
        `SELECT m.id,m.title,m.scale_label,m.map_year,m.preparing_agency,m.description,m.visibility,
                f.original_name,f.size_bytes,m.created_at,m.updated_at${internal}
         FROM cms.pdf_maps m JOIN core.file_objects f ON f.id=m.file_object_id
         WHERE m.id=$1 AND m.deleted_at IS NULL AND f.lifecycle_status='ready' AND ${contentAccess(mode, 'm')}`,
        [id],
    );
    return row || null;
};
const createPdfMap = async (input, actorId) => {
    const {
        rows: [row],
    } = await db.query(
        `INSERT INTO cms.pdf_maps(title,scale_label,map_year,preparing_agency,description,visibility,file_object_id,created_by,updated_by)
         SELECT $1,$2,$3,$4,$5,$6,f.id,$8,$8 FROM core.file_objects f
         WHERE f.id=$7 AND f.owner_user_id=$8 AND f.category='documents' AND f.lifecycle_status='ready'
           AND lower(f.original_name) ~ '\\.pdf$' AND f.detected_mime='application/pdf' RETURNING *`,
        [
            input.title,
            input.scaleLabel,
            input.mapYear,
            input.preparingAgency,
            input.description || null,
            input.visibility,
            input.fileObjectId,
            actorId,
        ],
    );
    return row || null;
};
const updatePdfMap = async (id, input, actorId) => {
    const sets = [];
    const params = [];
    const fields = {
        title: 'title',
        scaleLabel: 'scale_label',
        mapYear: 'map_year',
        preparingAgency: 'preparing_agency',
        description: 'description',
        visibility: 'visibility',
    };
    for (const [key, column] of Object.entries(fields)) {
        if (input[key] !== undefined) {
            params.push(input[key] === '' ? null : input[key]);
            sets.push(`${column}=$${params.length}`);
        }
    }
    params.push(actorId);
    sets.push(`updated_by=$${params.length}`);
    params.push(id);
    const idIndex = params.length;
    params.push(input.expectedUpdatedAt);
    const version = versionCondition(params.length);
    const {
        rows: [row],
    } = await db.query(
        `UPDATE cms.pdf_maps SET ${sets.join(',')} WHERE id=$${idIndex}
         AND deleted_at IS NULL ${version} RETURNING *`,
        params,
    );
    return row || null;
};
const deletePdfMap = async (id, expectedUpdatedAt) => {
    const params = [id, expectedUpdatedAt];
    const version = versionCondition(2);
    const {
        rows: [row],
    } = await db.query(
        `UPDATE cms.pdf_maps SET deleted_at=NOW() WHERE id=$1 AND deleted_at IS NULL ${version} RETURNING id`,
        params,
    );
    return row || null;
};

module.exports = {
    listNews,
    findNews,
    createNews,
    updateNews,
    deleteNews,
    listComments,
    createComment,
    moderateComment,
    listDocuments,
    findDocument,
    createDocument,
    deleteDocument,
    listPdfMaps,
    findPdfMap,
    createPdfMap,
    updatePdfMap,
    deletePdfMap,
};
