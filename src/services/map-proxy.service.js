'use strict';
const { requestGeoserver } = require('../utils/geoserver.client');
const { signTileTicket } = require('../utils/map-tile-ticket.util');
const { Api404Error, Api413Error } = require('../core/error.response');
const MAX_RESPONSE_BYTES = Number(process.env.MAP_PROXY_MAX_RESPONSE_MB || 25) * 1024 * 1024;
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
    const params = new URLSearchParams({
        service: 'WMS',
        request: 'GetMap',
        version: query.version,
        layers: assertLayer(layer),
        styles: resolveStyleName(layer),
        crs: query.crs,
        bbox: query.bbox,
        width: String(query.width),
        height: String(query.height),
        format: query.format,
        transparent: String(query.transparent),
    });
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
