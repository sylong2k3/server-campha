'use strict';

const layerService = require('../services/layer.service');
const { OK, CREATED, OK_LIST } = require('../core/success.response');
const { buildActor } = require('../utils/actor.util');

const enqueueShapefile = async (req, res) => {
    const job = await layerService.enqueueImport('shapefile', req.body, buildActor(req));
    CREATED(res, 'Đã xếp hàng import Shapefile', job);
};
const enqueueExcel = async (req, res) => {
    const job = await layerService.enqueueImport('excel', req.body, buildActor(req));
    CREATED(res, 'Đã xếp hàng import Excel', job);
};
const getImport = async (req, res) => {
    OK(
        res,
        'Lấy trạng thái import thành công',
        await layerService.getImport(Number(req.params.jobId), buildActor(req)),
    );
};
const listImportErrors = async (req, res) => {
    const result = await layerService.listImportErrors(
        Number(req.params.jobId),
        req.query.page,
        req.query.limit,
        buildActor(req),
    );
    OK_LIST(res, 'Lấy lỗi import thành công', result.items, {
        page: req.query.page,
        limit: req.query.limit,
        total: result.total,
    });
};
const listLayers = async (req, res) => {
    const result = await layerService.listLayers(req.query, buildActor(req));
    OK_LIST(res, 'Lấy danh sách lớp thành công', result.items, {
        page: req.query.page,
        limit: req.query.limit,
        total: result.total,
    });
};
const getLayer = async (req, res) => {
    OK(
        res,
        'Lấy lớp dữ liệu thành công',
        await layerService.getLayer(Number(req.params.layerId), buildActor(req)),
    );
};
const updateLayer = async (req, res) => {
    OK(
        res,
        'Cập nhật lớp dữ liệu thành công',
        await layerService.updateLayer(Number(req.params.layerId), req.body, buildActor(req)),
    );
};
const replacePermissions = async (req, res) => {
    OK(
        res,
        'Cập nhật phân quyền lớp thành công',
        await layerService.replacePermissions(
            Number(req.params.layerId),
            req.body,
            buildActor(req),
        ),
    );
};
const deleteLayer = async (req, res) => {
    OK(
        res,
        'Đã xếp hàng xóa lớp dữ liệu',
        await layerService.deleteLayer(
            Number(req.params.layerId),
            req.body.expectedUpdatedAt,
            buildActor(req),
        ),
    );
};
const retryPublish = async (req, res) => {
    OK(
        res,
        'Publish lớp dữ liệu thành công',
        await layerService.retryPublish(Number(req.params.layerId), buildActor(req)),
    );
};

module.exports = {
    enqueueShapefile,
    enqueueExcel,
    getImport,
    listImportErrors,
    listLayers,
    getLayer,
    updateLayer,
    replacePermissions,
    deleteLayer,
    retryPublish,
};
