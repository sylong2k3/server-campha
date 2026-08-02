'use strict';
const service = require('../services/shared-layer.service');
const { OK, CREATED, OK_LIST } = require('../core/success.response');
const list = async (req, res) => {
    const x = await service.list(req.params.slug, req.query, req.share);
    res.locals.sharedRowCount = x.items.length;
    OK_LIST(res, 'Lấy dữ liệu chia sẻ thành công', x.items, {
        page: req.query.page,
        limit: req.query.limit,
        total: x.total,
    });
};
const get = async (req, res) => {
    res.locals.sharedRowCount = 1;
    OK(
        res,
        'Lấy đối tượng chia sẻ thành công',
        await service.get(req.params.slug, req.params.featureId, req.share),
    );
};
const create = async (req, res) => {
    res.locals.sharedRowCount = 1;
    CREATED(
        res,
        'Tạo đối tượng chia sẻ thành công',
        await service.create(req.params.slug, req.body, req.share),
    );
};
const update = async (req, res) => {
    res.locals.sharedRowCount = 1;
    OK(
        res,
        'Cập nhật đối tượng chia sẻ thành công',
        await service.update(req.params.slug, req.params.featureId, req.body, req.share),
    );
};
const remove = async (req, res) => {
    res.locals.sharedRowCount = 1;
    OK(
        res,
        'Xóa đối tượng chia sẻ thành công',
        await service.remove(req.params.slug, req.params.featureId, req.body, req.share),
    );
};
module.exports = { list, get, create, update, remove };
