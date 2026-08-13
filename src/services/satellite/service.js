'use strict';

const gee = require('../gee-earth-engine.adapter');
const repository = require('../../repositories/satellite.repository');
const { hashRequest, requireSatelliteCache, toResponse } = require('./cache');
const { normalizeRequest } = require('./request');
const { buildImage } = require('./builders');

const exportDownload = async (adapter, image, params, region) =>
    adapter
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

    if (typeof adapter.ensureInitialized === 'function') {
        await adapter.ensureInitialized();
    }
    const build = deps.buildImage || buildImage;
    const { image, viz, region, stats = {}, legend = [], metadata: buildMetadata = {} } = await build(
        params,
        { evaluate: (value) => adapter.evaluate(value) },
    );
    const map = await adapter.getMapId(image, viz);
    const downloadUrl = await exportDownload(adapter, image, params, region);
    const metadata = {
        collection: params.collection,
        productVersion: params.productVersion,
        ...buildMetadata,
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
            stats,
            legend,
            metadata,
        }),
    );
    return toResponse(row, false);
}

module.exports = { processRequest };
