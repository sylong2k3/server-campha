'use strict';
const { requestGeoserver } = require('../utils/geoserver.client');
const { signTileTicket } = require('../utils/map-tile-ticket.util');
const { Api404Error, Api413Error } = require('../core/error.response');
const { buildSld, artifactCodeFromLayerCode, resolveKnownArtifactCode } = require('./flood/visualization/sld');
const MAX_RESPONSE_BYTES = Number(process.env.MAP_PROXY_MAX_RESPONSE_MB || 500) * 1024 * 1024;
const assertLayer = (layer) => {
    if (!layer?.geoserver_layer) {
        throw new Api404Error('Lớp chưa được publish trên GeoServer');
    }
    return layer.geoserver_layer;
};
const bufferResponse = async (response) => {
    const length = Number(response.headers.get('content-length') || 0);
    if (length > MAX_RESPONSE_BYTES) {
        throw new Api413Error('GeoServer response exceeds proxy limit');
    }
    const chunks = [];
    let size = 0;
    for await (const chunk of response.body) {
        size += chunk.length;
        if (size > MAX_RESPONSE_BYTES) {
            await response.body.cancel?.();
            throw new Api413Error('GeoServer response exceeds proxy limit');
        }
        chunks.push(Buffer.from(chunk));
    }
    return {
        body: Buffer.concat(chunks),
        contentType: response.headers.get('content-type') || 'application/octet-stream',
    };
};
const resolveStyleName = (layer) => {
    const explicit = layer?.style_name || layer?.styleName;
    if (typeof explicit === 'string' && explicit.trim()) return explicit.trim();
    const metaStyle = layer?.metadata?.style;
    if (typeof metaStyle === 'string' && metaStyle.trim()) return metaStyle.trim();
    return '';
};
const proxyWms = async (layer, query) => {
    const layerName = assertLayer(layer);

    // For flood artifact layers, build a per-request SLD from the legend palette
    // so GeoServer renders with the correct colors without needing persistent
    // GeoServer SLD styles (which the raster-ingest pipeline does not create).
    //
    // Resolve artifact code via three methods (in priority order):
    // 1. Parse layer.code for the fl_{module}_{artifact_code}_{tag} pattern
    //    (handles both legacy _r{id} and Monitoring _YYYY_MM_DD_YYYY_MM_DD tags;
    //     also resolves legacy code aliases, e.g. flood_main → main_flood_non_tidal)
    // 2. Use layer.style_name if it maps to a known artifact code or alias
    // 3. Use layer.metadata.style (always populated by the ingest pipeline for
    //    flood layers; style_name is NULL in the registry for these layers)
    const artifactCode =
        artifactCodeFromLayerCode(layer.code) ||
        resolveKnownArtifactCode(layer.style_name) ||
        resolveKnownArtifactCode(layer.metadata?.style);
    const sldBody = artifactCode ? buildSld(layerName, artifactCode) : null;

    if (!sldBody && layer.code?.startsWith('fl_')) {
        console.warn('[map-proxy] WMS: SLD could not be resolved for flood layer', {
            layerCode: layer.code,
            layerId: layer.id,
            geoserverLayer: layerName,
            styleName: layer.style_name,
            metadataStyle: layer.metadata?.style,
        });
    }

    const params = new URLSearchParams({
        service: 'WMS',
        request: 'GetMap',
        version: query.version,
        layers: layerName,
        styles: sldBody ? '' : resolveStyleName(layer),
        crs: query.crs,
        bbox: query.bbox,
        width: String(query.width),
        height: String(query.height),
        format: query.format,
        transparent: String(query.transparent),
        // Return a transparent blank tile instead of XML on GeoServer error.
        // Prevents Mapbox from receiving XML that it cannot decode as an image.
        exceptions: 'application/vnd.ogc.se_blank',
    });
    if (sldBody) {
        params.set('SLD_BODY', sldBody);
    }

    return bufferResponse(await requestGeoserver(`/wms?${params}`));
};
const proxyWfs = async (layer, query) => {
    const params = new URLSearchParams({
        service: 'WFS',
        request: 'GetFeature',
        version: '2.0.0',
        typeNames: assertLayer(layer),
        count: String(query.count),
        srsName: query.srsName,
        outputFormat: query.outputFormat,
    });
    if (query.bbox) {
        params.set('bbox', `${query.bbox},${query.srsName}`);
    }
    return bufferResponse(await requestGeoserver(`/wfs?${params}`));
};
const proxyWcs = async (layer, query) => {
    const layerName = assertLayer(layer);
    const params = new URLSearchParams({
        service: 'WCS',
        version: '2.0.1',
        request: 'GetCoverage',
        // GeoServer coverage identifiers use workspace__coverage, while the
        // published layer stored by this application is workspace:coverage.
        coverageId: layerName.replace(':', '__'),
        format: query.format,
    });
    return bufferResponse(await requestGeoserver(`/wcs?${params}`));
};
const issueTileTicket = (layer, access) => {
    assertLayer(layer);
    return signTileTicket(layer.id, access);
};
module.exports = { proxyWms, proxyWfs, proxyWcs, issueTileTicket, bufferResponse, MAX_RESPONSE_BYTES };
