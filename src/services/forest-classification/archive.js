'use strict';

const ingestConfig = require('../../configs/raster-ingest');

const queueSnapshotArchive = async (snapshot, result, deps = {}) => {
    if (!ingestConfig.isEnabled() || !result.downloadUrl) {
        return null;
    }
    const rasterIngest = deps.rasterIngest || require('../raster-ingest.service');
    const layerCode = `forest_classification_${snapshot.year}${String(snapshot.month).padStart(2, '0')}_${snapshot.id}`;
    const queued = await rasterIngest.enqueue({
        sourceUrl: result.downloadUrl,
        layerCode,
        nameVi: `Phân loại rừng ${snapshot.year}-${String(snapshot.month).padStart(2, '0')}`,
        category: 'forest',
        isPublic: true,
        requestParams: {
            bucketCategory: 'raster',
            publishCategory: 'raster',
            data_year: snapshot.year,
            linkedResource: { type: 'forest_snapshot', id: snapshot.id },
        },
        user: null,
        lang: 'vi',
    });
    return { ...queued, layerCode };
};

module.exports = { queueSnapshotArchive };
