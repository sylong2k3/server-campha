'use strict';

const repository = require('../../repositories/satellite.repository');
const { Api400Error, Api404Error } = require('../../core/error.response');
const { requireSatelliteCache } = require('./cache');

async function enqueueRasterPublish(resultId, actor, lang, deps = {}) {
    const repo = deps.repository || repository;
    const rasterIngest = deps.rasterIngest || require('../raster-ingest.service');
    const result = await requireSatelliteCache(() => repo.getById(resultId));
    if (!result) {
        throw new Api404Error('Kết quả ảnh vệ tinh không tồn tại hoặc đã hết hạn.', [
            'SATELLITE_RESULT_NOT_FOUND',
        ]);
    }
    if (result.geoserver_layer) {
        return { result, alreadyPublished: true };
    }
    const sourceUrl = result.metadata?.downloadUrl;
    if (!sourceUrl) {
        throw new Api400Error('Kết quả chưa có URL tải GeoTIFF để publish.', ['NO_DOWNLOAD_URL']);
    }
    const startTag = String(result.start_date).replace(/-/g, '');
    const layerCode = `satellite_${result.image_type}_${startTag}_${result.id}`.slice(0, 59);
    const { job, deduplicated } = await rasterIngest.enqueue({
        sourceUrl,
        layerCode,
        nameVi: `Ảnh vệ tinh ${result.image_type} ${result.start_date}`,
        category: 'remote_sensing',
        isPublic: true,
        requestParams: {
            bucketCategory: 'raster',
            publishCategory: 'raster',
            linkedResource: { type: 'satellite', id: result.id },
        },
        user: actor || null,
        lang,
    });
    return { result, job, deduplicated, layerCode, alreadyPublished: false };
}

module.exports = { enqueueRasterPublish };
