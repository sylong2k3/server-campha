'use strict';
const service = require('../services/api-registry.service');
const { OK, CREATED, OK_LIST } = require('../core/success.response');
const { buildActor } = require('../utils/actor.util');
const list = async (req, res) => {
    const x = await service.list(req.query, buildActor(req));
    OK_LIST(res, 'Lấy danh sách API lớp thành công', x.items, {
        page: req.query.page,
        limit: req.query.limit,
        total: x.total,
    });
};
const get = async (req, res) =>
    OK(
        res,
        'Lấy API lớp thành công',
        await service.get(Number(req.params.registryId), buildActor(req)),
    );
const create = async (req, res) =>
    CREATED(res, 'Tạo API lớp thành công', await service.create(req.body, buildActor(req)));
const update = async (req, res) =>
    OK(
        res,
        'Cập nhật API lớp thành công',
        await service.update(Number(req.params.registryId), req.body, buildActor(req)),
    );
const remove = async (req, res) =>
    OK(
        res,
        'Thu hồi API lớp thành công',
        await service.remove(
            Number(req.params.registryId),
            req.query.expectedVersion,
            buildActor(req),
        ),
    );
const keys = async (req, res) =>
    OK(
        res,
        'Lấy danh sách khóa thành công',
        await service.listKeys(Number(req.params.registryId), buildActor(req)),
    );
const issue = async (req, res) =>
    CREATED(
        res,
        'Cấp khóa chia sẻ thành công',
        await service.issue(Number(req.params.registryId), req.body, buildActor(req)),
    );
const revoke = async (req, res) =>
    OK(res, 'Thu hồi khóa thành công', await service.revoke(req.params.keyId, buildActor(req)));
const rotate = async (req, res) =>
    OK(
        res,
        'Xoay vòng khóa thành công',
        await service.rotate(req.params.keyId, req.body, buildActor(req)),
    );
const usage = async (req, res) =>
    OK(
        res,
        'Lấy thống kê hạn mức thành công',
        await service.usage(Number(req.params.registryId), req.query, buildActor(req)),
    );
module.exports = { list, get, create, update, remove, keys, issue, revoke, rotate, usage };
