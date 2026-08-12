'use strict';

const service = require('../services/remote-sensing.service');
const { OK, CREATED, OK_LIST } = require('../core/success.response');
const { buildActor } = require('../utils/actor.util');
const { t } = require('../utils/i18n.util');
const listResponse = (res, result, query, message) =>
    OK_LIST(res, message, result.items, {
        page: query.page,
        limit: query.limit,
        total: result.total,
    });
const list = async (req, res) =>
    listResponse(
        res,
        await service.list(req.query),
        req.query,
        t('satellite_list_success', req.lang),
    );
const listAdmin = async (req, res) =>
    listResponse(
        res,
        await service.listAdmin(req.query, buildActor(req)),
        req.query,
        t('satellite_admin_list_success', req.lang),
    );
const get = async (req, res) =>
    OK(
        res,
        t('satellite_detail_success', req.lang),
        await service.get(Number(req.params.id), req.lang),
    );
const compare = async (req, res) =>
    OK(
        res,
        t('satellite_compare_success', req.lang),
        await service.compare(req.query.beforeId, req.query.afterId, req.lang),
    );
const download = async (req, res) =>
    OK(
        res,
        t('satellite_download_success', req.lang),
        await service.download(Number(req.params.id), req.query.expireSeconds, buildActor(req)),
    );
const create = async (req, res) =>
    CREATED(
        res,
        t('satellite_created_success', req.lang),
        await service.create(req.body, buildActor(req)),
    );
const categorize = async (req, res) =>
    OK(
        res,
        t('satellite_categorized_success', req.lang),
        await service.categorize(Number(req.params.id), req.body, buildActor(req)),
    );
const publish = async (req, res) =>
    OK(
        res,
        'Xuất bản ảnh GeoTIFF lên Web Map thành công',
        await service.publish(Number(req.params.id), req.body, buildActor(req)),
    );
const remove = async (req, res) =>
    OK(
        res,
        t('satellite_deleted_success', req.lang),
        await service.remove(Number(req.params.id), req.query.expectedUpdatedAt, buildActor(req)),
    );
module.exports = {
    list,
    listAdmin,
    get,
    compare,
    download,
    create,
    categorize,
    publish,
    remove,
};
