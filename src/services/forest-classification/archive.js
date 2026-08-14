'use strict';

const ingestConfig = require('../../configs/raster-ingest');
const debug = require('./debug.util');

const queueSnapshotArchive = async (snapshot, result, deps = {}) => {
    if (!ingestConfig.isEnabled()) {
        debug.log('archive.skipped raster-ingest disabled', { snapshotId: snapshot.id });
        return null;
    }
    if (!result.downloadUrl) {
        debug.log('archive.skipped no downloadUrl', { snapshotId: snapshot.id });
        return null;
    }
    const rasterIngest = deps.rasterIngest || require('../raster-ingest.service');
    const layerCode = `forest_classification_${snapshot.year}${String(snapshot.month).padStart(2, '0')}_${snapshot.id}`;
    debug.log('archive.enqueue', {
        snapshotId: snapshot.id,
        layerCode,
        bucketCategory: 'raster',
    });
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
    debug.log('archive.enqueue result', {
        snapshotId: snapshot.id,
        layerCode,
        jobId: queued?.job?.id || null,
        deduplicated: queued?.deduplicated || false,
    });
    return { ...queued, layerCode };
};

module.exports = { queueSnapshotArchive };
