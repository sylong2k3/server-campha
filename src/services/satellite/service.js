'use strict';

const gee = require('../gee-earth-engine.adapter');
const repository = require('../../repositories/satellite.repository');
const { hashRequest, requireSatelliteCache, toResponse } = require('./cache');
const { normalizeRequest } = require('./request');
const { buildImage } = require('./builders');

/**
 * A GeoTIFF necessarily has a rectangular extent, but clipping the image to the
 * supplied polygon makes every pixel outside that polygon NoData. Supplying the
 * same polygon as `region` prevents Earth Engine from expanding the request to
 * a source image's footprint or an AOI bounding box.
 */
const clipForPolygonDownload = (image, region) => image.clip(region);

const exportDownload = async (adapter, image, params, region, scale = 30) =>
    adapter
        .getDownloadUrl(image, {
            name: `satellite_${params.type}_${params.startDate}`,
            region,
            scale,
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
    // Enforce clipping at the delivery boundary for every image type. Individual
    // builders may already clip their composites, but this also protects future
    // builders and prevents the fire-risk base image from filling outside RG.
    const clippedImage = clipForPolygonDownload(image, region);
    const map = await adapter.getMapId(clippedImage, viz);
    const downloadScale = Number(buildMetadata.downloadScaleMeters);
    const downloadUrl = await exportDownload(
        adapter,
        clippedImage,
        params,
        region,
        Number.isFinite(downloadScale) && downloadScale > 0 ? downloadScale : 30,
    );
    const metadata = {
        collection: params.collection,
        productVersion: params.productVersion,
        ...buildMetadata,
        downloadClip: {
            geometrySource: params.geometrySource,
            method: 'polygon-mask',
        },
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

module.exports = { clipForPolygonDownload, processRequest };
