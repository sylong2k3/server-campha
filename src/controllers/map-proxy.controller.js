'use strict';
const mapProxyService = require('../services/map-proxy.service');
const send = async (res, result) => {
    res.set({ 'Content-Type': result.contentType, 'Cache-Control': 'private, max-age=60', 'X-Content-Type-Options': 'nosniff' });
    res.status(200).send(result.body);
};
const wms = async (req, res) => send(res, await mapProxyService.proxyWms(req.layerAcl, req.query));
const wfs = async (req, res) => send(res, await mapProxyService.proxyWfs(req.layerAcl, req.query));
module.exports = { wms, wfs };