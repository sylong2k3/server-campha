'use strict';

const gee = require('../gee-earth-engine.adapter');
const repository = require('../../repositories/satellite.repository');
const { LEGENDS, hashRequest, requireSatelliteCache, toResponse } = require('./cache');
const { normalizeRequest } = require('./request');
const { buildImage } = require('./builders');

const exportDownload = async (image, params, region) =>
    gee
        .getDownloadUrl(image, {
            name: `satellite_${params.type}_${params.startDate}`,
            region,
            scale: 30,
            // A single TIFF is compatible with the shared raster-ingest pipeline.
            // Earth Engine's default output is a ZIP archive.
            format: 'GEO_TIFF',
            filePerBand: false,
        })
        .catch(() => null);

async function processRequest(imageType, rawParams, deps = {}) {
    const repo = deps.repository || repository;
    const adapter = deps.gee || gee;
    const params = normalizeRequest(imageType, rawParams);
    const requestHash = hashRequest(params);
    const cached = await requireSatelliteCache(() => repo.getByHash(requestHash));
    if (cached) {
        return toResponse(cached, true);
    }

    const { image, viz, region } = buildImage(params);
    const map = await adapter.getMapId(image, viz);
    const downloadUrl = await exportDownload(image, params, region);
    const metadata = {
        collection: params.collection,
        source: ['heatmap', 'fire-risk'].includes(params.type)
            ? 'LANDSAT_C2_L2'
            : params.collection,
        generatedAt: new Date().toISOString(),
        downloadUrl,
        downloadFilename: downloadUrl ? `satellite_${params.type}_${params.startDate}.tif` : null,
    };
    const row = await requireSatelliteCache(() =>
        repo.upsert({
            requestHash,
            imageType: params.type,
            collection: params.collection,
            startDate: params.startDate,
            endDate: params.endDate,
            geometry: params.geometry,
            tileUrl: map.tileUrl,
            mapId: map.mapId,
            stats: {},
            legend: LEGENDS[params.type],
            metadata,
        }),
    );
    return toResponse(row, false);
}

module.exports = { processRequest };
