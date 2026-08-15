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
const assertFileNotInUse = (row) => {
    if (row?.conflict === 'FILE_STILL_IN_USE') {
        throw new Api409Error('File vẫn đang được dữ liệu khác sử dụng', [
            'FILE_STILL_IN_USE',
            ...row.references,
        ]);
    }
};
const managedFileLink = async (row, expireSeconds) => {
    const link =
        row.visibility === 'public'
            ? minioService.getPublicFileUrl(row.file_object_id)
            : await minioService.getPresignedDownloadUrl({
                  objectKey: row.object_key,
                  category: 'documents',
                  expireSeconds,
                  fileId: row.file_object_id,
              });
    return { url: link.url, expiresAt: link.expiresAt, fileName: row.original_name };
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
const deleteNews = async (id, expectedUpdatedAt, _deleteFiles, actor) => {
    requirePermission(actor, 'news', 'delete');
    const row = await repository.deleteNews(id, expectedUpdatedAt);
    const changed = await changedOrError(
        row,
        () => repository.findNews(id, false),
        'Không tìm thấy tin tức',
    );
    audit('news_deleted', actor, { newsId: id });
    return { ...changed, fileCleanupQueued: false, fileObjectIds: [] };
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
const getPublicComment = async (commentId) => {
    const comment = await repository.findComment(commentId, true);
    if (!comment) {
        throw new Api404Error('Không tìm thấy bình luận');
    }
    return comment;
};
const getAdminComment = async (commentId, actor) => {
    requirePermission(actor, 'news', 'read');
    const comment = await repository.findComment(commentId, false);
    if (!comment) {
        throw new Api404Error('Không tìm thấy bình luận');
    }
    return comment;
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
const updateDocument = async (id, input, actor) => {
    requirePermission(actor, 'documents', 'update');
    try {
        const row = await repository.updateDocument(id, input);
        const changed = await changedOrError(
            row,
            () => repository.findDocument(id, 'admin'),
            'Không tìm thấy văn bản',
        );
        audit('document_updated', actor, { documentId: id });
        return changed;
    } catch (error) {
        if (error.code === '23505') {
            throw new Api409Error('Mã văn bản đã tồn tại', ['DOCUMENT_CONFLICT']);
        }
        throw error;
    }
};
const deleteDocument = async (id, expectedUpdatedAt, deleteFiles, actor) => {
    requirePermission(actor, 'documents', 'delete');
    const row = await repository.deleteDocument(id, expectedUpdatedAt, actor.id, deleteFiles);
    assertFileNotInUse(row);
    const changed = await changedOrError(
        row,
        () => repository.findDocument(id, 'admin'),
        'Không tìm thấy văn bản',
    );
    audit('document_deleted', actor, { documentId: id, deleteFiles });
    return changed;
};
const documentDownload = async (id, expireSeconds, actor) => {
    const mode = has(actor, 'documents', 'download_internal') ? 'admin' : 'public';
    const row = await getOr404(
        () => repository.findDocument(id, mode, true),
        'Không tìm thấy văn bản',
    );
    return managedFileLink(row, expireSeconds);
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
const deletePdfMap = async (id, expectedUpdatedAt, deleteFiles, actor) => {
    requirePermission(actor, 'pdf_maps', 'delete');
    const row = await repository.deletePdfMap(id, expectedUpdatedAt, actor.id, deleteFiles);
    assertFileNotInUse(row);
    const changed = await changedOrError(
        row,
        () => repository.findPdfMap(id, 'admin'),
        'Không tìm thấy bản đồ PDF',
    );
    audit('pdf_map_deleted', actor, { pdfMapId: id, deleteFiles });
    return changed;
};
const pdfMapDownload = async (id, expireSeconds, actor) => {
    const canDownloadInternal =
        has(actor, 'pdf_maps', 'read') && has(actor, 'pdf_maps', 'download');
    const row = await getOr404(
        () => repository.findPdfMap(id, canDownloadInternal ? 'admin' : 'public', true),
        'Không tìm thấy bản đồ PDF',
    );
    return managedFileLink(row, expireSeconds);
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
    getPublicComment,
    listAdminComments,
    getAdminComment,
    createComment,
    moderateComment,
    listDocuments,
    getDocument,
    createDocument,
    updateDocument,
    deleteDocument,
    documentDownload,
    listPdfMaps,
    getPdfMap,
    createPdfMap,
    updatePdfMap,
    deletePdfMap,
    pdfMapDownload,
};
