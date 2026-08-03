'use strict';

const service = require('../services/kttv.service');
const { OK, CREATED, OK_LIST } = require('../core/success.response');
const { buildActor } = require('../utils/actor.util');

const list = (res, result, query, message) =>
    OK_LIST(res, message, result.items, {
        page: query.page,
        limit: query.limit,
        total: result.total,
    });

// ─── Sources ─────────────────────────────────────────────────────────────────

const listSources = async (req, res) =>
    list(
        res,
        await service.listSources(req.query, buildActor(req)),
        req.query,
        'Danh sách nguồn KTTV',
    );
const getSource = async (req, res) =>
    OK(res, 'Chi tiết nguồn KTTV', await service.getSource(Number(req.params.id), buildActor(req)));
const createSource = async (req, res) =>
    CREATED(res, 'Đã tạo nguồn KTTV', await service.createSource(req.body, buildActor(req)));
const updateSource = async (req, res) =>
    OK(
        res,
        'Đã cập nhật nguồn KTTV',
        await service.updateSource(Number(req.params.id), req.body, buildActor(req)),
    );
const deleteSource = async (req, res) =>
    OK(
        res,
        'Đã xóa nguồn KTTV',
        await service.deleteSource(
            Number(req.params.id),
            req.query.expectedUpdatedAt,
            buildActor(req),
        ),
    );
const testSourceConnection = async (req, res) =>
    OK(
        res,
        'Kết quả kiểm tra kết nối',
        await service.testSourceConnection(Number(req.params.id), buildActor(req)),
    );

// ─── Stations ────────────────────────────────────────────────────────────────

const listStations = async (req, res) =>
    list(
        res,
        await service.listStations(req.query, buildActor(req)),
        req.query,
        'Danh sách trạm quan trắc',
    );
const getStation = async (req, res) =>
    OK(res, 'Chi tiết trạm quan trắc', await service.getStation(req.params.code, buildActor(req)));
const createStation = async (req, res) =>
    CREATED(res, 'Đã tạo trạm quan trắc', await service.createStation(req.body, buildActor(req)));
const updateStation = async (req, res) =>
    OK(
        res,
        'Đã cập nhật trạm quan trắc',
        await service.updateStation(req.params.code, req.body, buildActor(req)),
    );
const deleteStation = async (req, res) =>
    OK(
        res,
        'Đã xóa trạm quan trắc',
        await service.deleteStation(req.params.code, req.query.expectedUpdatedAt, buildActor(req)),
    );

module.exports = {
    listSources,
    getSource,
    createSource,
    updateSource,
    deleteSource,
    testSourceConnection,
    listStations,
    getStation,
    createStation,
    updateStation,
    deleteStation,
};
