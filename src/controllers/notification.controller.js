'use strict';
const service = require('../services/notification.service');
const { OK, OK_LIST } = require('../core/success.response');
const { buildActor } = require('../utils/actor.util');
const { t } = require('../utils/i18n.util');
const actor = (req) => buildActor(req);
const listMine = async (req, res) => {
    const result = await service.listMine(actor(req).id, req.query);
    return OK_LIST(res, t('get_list_success', req.lang), result.items, {
        ...req.query,
        total: result.total,
    });
};
const unreadCount = async (req, res) =>
    OK(res, t('get_success', req.lang), { count: await service.unreadCount(actor(req).id) });
const markRead = async (req, res) =>
    OK(
        res,
        t('notification_marked_read', req.lang),
        await service.markRead(Number(req.params.id), actor(req).id),
    );
const markAllRead = async (req, res) =>
    OK(
        res,
        t('notifications_all_read', req.lang),
        await service.markAllRead(actor(req).id),
    );
module.exports = { listMine, unreadCount, markRead, markAllRead };
