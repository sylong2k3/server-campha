'use strict';
const mapProxyService = require('../services/map-proxy.service');
const { OK } = require('../core/success.response');
const { t } = require('../utils/i18n.util');
const send = async (res, result) => {
    res.set({
        'Content-Type': result.contentType,
        'Cache-Control': 'private, max-age=60',
        'X-Content-Type-Options': 'nosniff',
    });
    res.status(200).send(result.body);
};
const wms = async (req, res) => send(res, await mapProxyService.proxyWms(req.layerAcl, req.query));
const wfs = async (req, res) => send(res, await mapProxyService.proxyWfs(req.layerAcl, req.query));
const wcs = async (req, res) => send(res, await mapProxyService.proxyWcs(req.layerAcl, req.query));
const tileTicket = async (req, res) => {
    const result = mapProxyService.issueTileTicket(req.layerAcl, req.query.access);
    OK(res, t('map_tile_ticket_issued', req.lang), result);
};
module.exports = { wms, wfs, wcs, tileTicket };
