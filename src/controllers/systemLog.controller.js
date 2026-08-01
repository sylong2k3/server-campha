const systemLogService = require('../services/systemLog.service');
const { OK, OK_LIST } = require('../core/success.response');
const { t } = require('../utils/i18n.util');
const { buildActor } = require('../utils/actor.util');

const listSystemLogs = async (req, res) => {
    const { page, limit, level, source, q, dateFrom, dateTo } = req.query;
    const filter = { page, limit, level, source, q, dateFrom, dateTo };
    const { items, total } = await systemLogService.listSystemLogs(filter);
    OK_LIST(res, t('get_list_success', req.lang), items, {
        page: filter.page,
        limit: filter.limit,
        total,
    });
};

const cleanupSystemLogs = async (req, res) => {
    const result = await systemLogService.cleanupSystemLogs(req.body.olderThanDays, buildActor(req));
    OK(res, result.message, { deleted: result.deleted });
};

module.exports = { listSystemLogs, cleanupSystemLogs };
