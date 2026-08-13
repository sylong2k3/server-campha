'use strict';

const { processRequest } = require('./service');
const { enqueueRasterPublish } = require('./publish');

module.exports = {
    processRequest,
    getRgb: (params) => processRequest('rgb', params),
    getNdvi: (params) => processRequest('ndvi', params),
    getHeatmap: (params) => processRequest('heatmap', params),
    getClassified: (params) => processRequest('classified', params),
    getFireRisk: (params) => processRequest('fire-risk', params),
    enqueueRasterPublish,
};
