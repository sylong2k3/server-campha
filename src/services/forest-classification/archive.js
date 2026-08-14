'use strict';

const ingestConfig = require('../../configs/raster-ingest');
const debug = require('./debug.util');

const buildPeriodLayerCode = (year, month) =>
    `forest_classification_${year}${String(month).padStart(2, '0')}`;

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
    // A period has one canonical raster. Re-running a successful period
    // re-ingests this stable layer instead of accumulating snapshot layers.
    const layerCode = buildPeriodLayerCode(snapshot.year, snapshot.month);
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
            objectKeyTag: 'latest',
            objectKeyYear: snapshot.year,
            objectKeyMonth: snapshot.month,
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

module.exports = { buildPeriodLayerCode, queueSnapshotArchive };
