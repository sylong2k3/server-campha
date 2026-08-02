'use strict';

const repository = require('../repositories/cms.repository');
const minioService = require('./minio.service');
const systemLogger = require('../utils/systemLogger.util');
const { Api403Error, Api404Error, Api409Error, Api422Error } = require('../core/error.response');

const has = (actor, resource, action) => actor?.permissions?.[resource]?.[action] === true;
const requirePermission = (actor, resource, action) => {
    if (!has(actor, resource, action)) {
        throw new Api403Error('Không có quyền thực hiện thao tác CMS');
    }
};
const audit = (action, actor, metadata) =>
    systemLogger.logInfo('cms', action, {
        actorId: actor.id,
        role: actor.role,
        orgId: actor.orgId,
        ...metadata,
    });
const getOr404 = async (loader, message) => {
    const value = await loader();
    if (!value) {
        throw new Api404Error(message);
    }
    return value;
};
const changedOrError = async (value, exists, message) => {
    if (value) {
        return value;
    }
    if (!(await exists())) {
        throw new Api404Error(message);
    }
    throw new Api409Error('Dữ liệu đã thay đổi; vui lòng tải lại', ['OPTIMISTIC_LOCK_CONFLICT']);
};

const listPublicNews = (filter) => repository.listNews(filter, true);
const getPublicNews = (id) =>
    getOr404(() => repository.findNews(id, true), 'Không tìm thấy tin tức');
const listAdminNews = (filter, actor) => {
    requirePermission(actor, 'news', 'read');
    return repository.listNews(filter, false);
};
const getAdminNews = (id, actor) => {
    requirePermission(actor, 'news', 'read');
    return getOr404(() => repository.findNews(id, false), 'Không tìm thấy tin tức');
};
const createNews = async (input, actor) => {
    requirePermission(actor, 'news', 'create');
    const row = await repository.createNews(input, actor.id);
    audit('news_created', actor, {
        newsId: row.id,
        status: row.status,
        visibility: row.visibility,
    });
    return row;
};
const updateNews = async (id, input, actor) => {
    requirePermission(actor, 'news', 'update');
    const row = await repository.updateNews(id, input, actor.id);
    const changed = await changedOrError(
        row,
        () => repository.findNews(id, false),
        'Không tìm thấy tin tức',
    );
    audit('news_updated', actor, { newsId: id });
    return changed;
};
const deleteNews = async (id, expectedUpdatedAt, actor) => {
    requirePermission(actor, 'news', 'delete');
    const row = await repository.deleteNews(id, expectedUpdatedAt);
    const changed = await changedOrError(
        row,
        () => repository.findNews(id, false),
        'Không tìm thấy tin tức',
    );
    audit('news_deleted', actor, { newsId: id });
    return changed;
};
const listPublicComments = (newsId, filter) => repository.listComments(newsId, filter, true);
const listAdminComments = (newsId, filter, actor) => {
    requirePermission(actor, 'news', 'read');
    return repository.listComments(newsId, filter, false);
};
const createComment = async (newsId, input, actor) => {
    requirePermission(actor, 'news', 'comment');
    const row = await repository.createComment(newsId, input.content, actor.id);
    if (!row) {
        throw new Api404Error('Không tìm thấy tin tức công khai');
    }
    audit('news_comment_created', actor, { newsId, commentId: row.id });
    return row;
};
const moderateComment = async (commentId, status, actor) => {
    requirePermission(actor, 'news', 'update');
    const row = await repository.moderateComment(commentId, status, actor.id);
    if (!row) {
        throw new Api404Error('Không tìm thấy bình luận');
    }
    audit('news_comment_moderated', actor, { commentId, status });
    return row;
};

const modeForDocuments = (actor) => {
    if (!actor) {
        return 'public';
    }
    if (has(actor, 'documents', 'read_internal')) {
        return 'admin';
    }
    return 'public';
};
const listDocuments = (filter, actor, admin = false) => {
    if (admin) {
        requirePermission(actor, 'documents', 'read');
        return repository.listDocuments(filter, 'admin');
    }
    return repository.listDocuments(filter, modeForDocuments(actor));
};
const getDocument = (id, actor, admin = false) => {
    const mode = admin
        ? (requirePermission(actor, 'documents', 'read'), 'admin')
        : modeForDocuments(actor);
    return getOr404(() => repository.findDocument(id, mode), 'Không tìm thấy văn bản');
};
const createDocument = async (input, actor) => {
    requirePermission(actor, 'documents', 'create');
    try {
        const row = await repository.createDocument(input, actor.id);
        if (!row) {
            throw new Api422Error('File chưa sẵn sàng, sai định dạng hoặc không thuộc người dùng', [
                'INVALID_DOCUMENT_FILE',
            ]);
        }
        audit('document_created', actor, { documentId: row.id, visibility: row.visibility });
        return row;
    } catch (error) {
        if (error.code === '23505') {
            throw new Api409Error('Mã văn bản hoặc file đã tồn tại', ['DOCUMENT_CONFLICT']);
        }
        throw error;
    }
};
const deleteDocument = async (id, expectedUpdatedAt, actor) => {
    requirePermission(actor, 'documents', 'delete');
    const row = await repository.deleteDocument(id, expectedUpdatedAt);
    const changed = await changedOrError(
        row,
        () => repository.findDocument(id, 'admin'),
        'Không tìm thấy văn bản',
    );
    audit('document_deleted', actor, { documentId: id });
    return changed;
};
const documentDownload = async (id, expireSeconds, actor) => {
    requirePermission(actor, 'documents', 'download_internal');
    const row = await getOr404(
        () => repository.findDocument(id, 'admin', true),
        'Không tìm thấy văn bản',
    );
    const signed = await minioService.getPresignedDownloadUrl({
        objectKey: row.object_key,
        category: 'documents',
        expireSeconds,
    });
    return { url: signed.url, expiresAt: signed.expiresAt, fileName: row.original_name };
};

const modeForPdf = (actor, admin) =>
    admin ? (requirePermission(actor, 'pdf_maps', 'read'), 'admin') : 'public';
const listPdfMaps = (filter, actor, admin = false) =>
    repository.listPdfMaps(filter, modeForPdf(actor, admin));
const getPdfMap = (id, actor, admin = false) =>
    getOr404(
        () => repository.findPdfMap(id, modeForPdf(actor, admin)),
        'Không tìm thấy bản đồ PDF',
    );
const createPdfMap = async (input, actor) => {
    requirePermission(actor, 'pdf_maps', 'create');
    try {
        const row = await repository.createPdfMap(input, actor.id);
        if (!row) {
            throw new Api422Error('File PDF chưa sẵn sàng hoặc không thuộc người dùng', [
                'INVALID_PDF_FILE',
            ]);
        }
        audit('pdf_map_created', actor, { pdfMapId: row.id, visibility: row.visibility });
        return row;
    } catch (error) {
        if (error.code === '23505') {
            throw new Api409Error('File PDF đã được sử dụng', ['PDF_MAP_FILE_CONFLICT']);
        }
        throw error;
    }
};
const updatePdfMap = async (id, input, actor) => {
    requirePermission(actor, 'pdf_maps', 'update');
    const row = await repository.updatePdfMap(id, input, actor.id);
    const changed = await changedOrError(
        row,
        () => repository.findPdfMap(id, 'admin'),
        'Không tìm thấy bản đồ PDF',
    );
    audit('pdf_map_updated', actor, { pdfMapId: id });
    return changed;
};
const deletePdfMap = async (id, expectedUpdatedAt, actor) => {
    requirePermission(actor, 'pdf_maps', 'delete');
    const row = await repository.deletePdfMap(id, expectedUpdatedAt);
    const changed = await changedOrError(
        row,
        () => repository.findPdfMap(id, 'admin'),
        'Không tìm thấy bản đồ PDF',
    );
    audit('pdf_map_deleted', actor, { pdfMapId: id });
    return changed;
};
const pdfMapDownload = async (id, expireSeconds, actor) => {
    requirePermission(actor, 'pdf_maps', 'download');
    const row = await getOr404(
        () => repository.findPdfMap(id, 'public', true),
        'Không tìm thấy bản đồ PDF',
    );
    const signed = await minioService.getPresignedDownloadUrl({
        objectKey: row.object_key,
        category: 'documents',
        expireSeconds,
    });
    return { url: signed.url, expiresAt: signed.expiresAt, fileName: row.original_name };
};

module.exports = {
    listPublicNews,
    getPublicNews,
    listAdminNews,
    getAdminNews,
    createNews,
    updateNews,
    deleteNews,
    listPublicComments,
    listAdminComments,
    createComment,
    moderateComment,
    listDocuments,
    getDocument,
    createDocument,
    deleteDocument,
    documentDownload,
    listPdfMaps,
    getPdfMap,
    createPdfMap,
    updatePdfMap,
    deletePdfMap,
    pdfMapDownload,
};
