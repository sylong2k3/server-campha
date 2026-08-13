'use strict';

const satellite = require('../services/satellite.service');
const { OK, CREATED } = require('../core/success.response');
const { Api400Error } = require('../core/error.response');

const respond = (method) => async (req, res) => {
    const data = await satellite[method](req.body || {});
    OK(res, 'Lấy ảnh vệ tinh thành công.', data);
};

const publish = async (req, res) => {
    const id = Number(req.params.id || req.body?.resultId);
    if (!Number.isInteger(id) || id <= 0) {
        throw new Api400Error('resultId không hợp lệ.', ['INVALID_RESULT_ID']);
    }
    const data = await satellite.enqueueRasterPublish(id, req.user, req.lang);
    if (data.alreadyPublished) {
        return OK(res, 'Ảnh đã được công bố trên bản đồ.', {
            resultId: id,
            geoserverLayer: data.result.geoserver_layer,
            alreadyPublished: true,
        });
    }
    return CREATED(res, 'Đã tiếp nhận yêu cầu publish ảnh vệ tinh.', {
        resultId: id,
        jobId: data.job.id,
        status: data.job.status,
        layerCode: data.layerCode,
        deduplicated: Boolean(data.deduplicated),
    });
};

module.exports = {
    getRgb: respond('getRgb'),
    getNdvi: respond('getNdvi'),
    getHeatmap: respond('getHeatmap'),
    getClassified: respond('getClassified'),
    getFireRisk: respond('getFireRisk'),
    publishToGeoServer: publish,
    publishToRaster: publish,
};
