'use strict';

const service = require('../services/cms.service');
const { OK, CREATED, OK_LIST } = require('../core/success.response');
const { buildActor } = require('../utils/actor.util');

const list = (res, result, query, message) =>
    OK_LIST(res, message, result.items, {
        page: query.page,
        limit: query.limit,
        total: result.total,
    });
const listPublicNews = async (req, res) =>
    list(res, await service.listPublicNews(req.query), req.query, 'Danh sách tin tức');
const getPublicNews = async (req, res) =>
    OK(res, 'Chi tiết tin tức', await service.getPublicNews(Number(req.params.id)));
const listAdminNews = async (req, res) =>
    list(
        res,
        await service.listAdminNews(req.query, buildActor(req)),
        req.query,
        'Danh sách tin tức quản trị',
    );
const getAdminNews = async (req, res) =>
    OK(res, 'Chi tiết tin tức', await service.getAdminNews(Number(req.params.id), buildActor(req)));
const createNews = async (req, res) =>
    CREATED(res, 'Đã tạo tin tức', await service.createNews(req.body, buildActor(req)));
const updateNews = async (req, res) =>
    OK(
        res,
        'Đã cập nhật tin tức',
        await service.updateNews(Number(req.params.id), req.body, buildActor(req)),
    );
const deleteNews = async (req, res) =>
    OK(
        res,
        'Đã xóa tin tức',
        await service.deleteNews(
            Number(req.params.id),
            req.query.expectedUpdatedAt,
            req.query.deleteFiles,
            buildActor(req),
        ),
    );
const listPublicComments = async (req, res) =>
    list(
        res,
        await service.listPublicComments(Number(req.params.id), req.query),
        req.query,
        'Danh sách bình luận',
    );
const listAdminComments = async (req, res) =>
    list(
        res,
        await service.listAdminComments(Number(req.params.id), req.query, buildActor(req)),
        req.query,
        'Danh sách bình luận quản trị',
    );
const createComment = async (req, res) =>
    CREATED(
        res,
        'Bình luận đang chờ duyệt',
        await service.createComment(Number(req.params.id), req.body, buildActor(req)),
    );
const moderateComment = async (req, res) =>
    OK(
        res,
        'Đã kiểm duyệt bình luận',
        await service.moderateComment(
            Number(req.params.commentId),
            req.body.status,
            buildActor(req),
        ),
    );
const listDocuments = async (req, res) =>
    list(
        res,
        await service.listDocuments(req.query, buildActor(req)),
        req.query,
        'Danh sách văn bản',
    );
const getDocument = async (req, res) =>
    OK(res, 'Chi tiết văn bản', await service.getDocument(Number(req.params.id), buildActor(req)));
const listAdminDocuments = async (req, res) =>
    list(
        res,
        await service.listDocuments(req.query, buildActor(req), true),
        req.query,
        'Danh sách văn bản quản trị',
    );
const getAdminDocument = async (req, res) =>
    OK(
        res,
        'Chi tiết văn bản',
        await service.getDocument(Number(req.params.id), buildActor(req), true),
    );
const createDocument = async (req, res) =>
    CREATED(res, 'Đã tạo văn bản', await service.createDocument(req.body, buildActor(req)));
const deleteDocument = async (req, res) =>
    OK(
        res,
        'Đã xóa văn bản',
        await service.deleteDocument(
            Number(req.params.id),
            req.query.expectedUpdatedAt,
            req.query.deleteFiles,
            buildActor(req),
        ),
    );
const documentDownload = async (req, res) =>
    OK(
        res,
        'URL tải văn bản',
        await service.documentDownload(
            Number(req.params.id),
            req.query.expireSeconds,
            buildActor(req),
        ),
    );
const listPdfMaps = async (req, res) =>
    list(
        res,
        await service.listPdfMaps(req.query, buildActor(req)),
        req.query,
        'Danh sách bản đồ PDF',
    );
const getPdfMap = async (req, res) =>
    OK(res, 'Chi tiết bản đồ PDF', await service.getPdfMap(Number(req.params.id), buildActor(req)));
const listAdminPdfMaps = async (req, res) =>
    list(
        res,
        await service.listPdfMaps(req.query, buildActor(req), true),
        req.query,
        'Danh sách bản đồ PDF quản trị',
    );
const getAdminPdfMap = async (req, res) =>
    OK(
        res,
        'Chi tiết bản đồ PDF',
        await service.getPdfMap(Number(req.params.id), buildActor(req), true),
    );
const createPdfMap = async (req, res) =>
    CREATED(res, 'Đã tạo bản đồ PDF', await service.createPdfMap(req.body, buildActor(req)));
const updatePdfMap = async (req, res) =>
    OK(
        res,
        'Đã cập nhật bản đồ PDF',
        await service.updatePdfMap(Number(req.params.id), req.body, buildActor(req)),
    );
const deletePdfMap = async (req, res) =>
    OK(
        res,
        'Đã xóa bản đồ PDF',
        await service.deletePdfMap(
            Number(req.params.id),
            req.query.expectedUpdatedAt,
            req.query.deleteFiles,
            buildActor(req),
        ),
    );
const pdfMapDownload = async (req, res) =>
    OK(
        res,
        'URL tải bản đồ PDF',
        await service.pdfMapDownload(
            Number(req.params.id),
            req.query.expireSeconds,
            buildActor(req),
        ),
    );

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
    listAdminDocuments,
    getAdminDocument,
    createDocument,
    deleteDocument,
    documentDownload,
    listPdfMaps,
    getPdfMap,
    listAdminPdfMaps,
    getAdminPdfMap,
    createPdfMap,
    updatePdfMap,
    deletePdfMap,
    pdfMapDownload,
};
