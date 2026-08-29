const { assertGeoserverConfigured, validateResourceName } = require('../configs/geoserver');
const { t } = require('./i18n.util');

// ─── Custom Error ─────────────────────────────────────────────────────────────

class GeoServerError extends Error {
    constructor(message, status, body) {
        super(message);
        this.name = 'GeoServerError';
        this.status = status;
        Object.defineProperty(this, 'responseBody', { value: body, enumerable: false });
    }
}

const normalizeBaseUrl = (url) => url.replace(/\/+$/, '');

const authHeader = ({ user, password }) =>
    `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`;

const requestGeoserver = async (path, options = {}) => {
    const config = assertGeoserverConfigured();
    if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//')) {
        throw new TypeError('GeoServer path must be an absolute application path');
    }
    const url = `${normalizeBaseUrl(config.url)}${path}`;
    const { timeoutMs: requestedTimeoutMs, ...fetchInput } = options;
    const timeoutMs = Number.isFinite(requestedTimeoutMs) ? requestedTimeoutMs : config.timeoutMs;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const fetchOptions = {
            ...fetchInput,
            redirect: 'error',
            signal: controller.signal,
            headers: {
                Authorization: authHeader(config),
                ...(fetchInput.headers || {}),
            },
        };
        if (options.body && typeof options.body.pipe === 'function') {
            fetchOptions.duplex = 'half';
        }
        const res = await fetch(url, fetchOptions);

        if (!res.ok) {
            const body = await res.text().catch(() => '');
            throw new GeoServerError(
                `GeoServer request failed with status ${res.status}`,
                res.status,
                body.slice(0, 1000),
            );
        }

        return res;
    } catch (err) {
        if (err.name === 'AbortError') {
            throw new GeoServerError(`GeoServer timeout sau ${timeoutMs}ms`, 504, '');
        }
        throw err;
    } finally {
        clearTimeout(timer);
    }
};

const publishVectorLayer = async (layer) => {
    const config = assertGeoserverConfigured();
    const workspace = config.workspace;
    const datastore = layer.geoserver_store || config.datastore;
    const featureName = layer.table_name;
    const srs = `EPSG:${layer.epsg_code || 4326}`;

    try {
        await requestGeoserver(
            `/rest/workspaces/${workspace}/datastores/${datastore}/featuretypes`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    featureType: {
                        name: featureName,
                        nativeName: featureName,
                        srs,
                        enabled: layer.is_active !== false,
                        title: layer.name_vi || featureName,
                    },
                }),
            },
        );
    } catch (err) {
        if (!isAlreadyExistsError(err)) {
            throw err;
        }
    }

    return `${workspace}:${featureName}`;
};
const isAlreadyExistsError = (err) =>
    err instanceof GeoServerError &&
    /already exists/i.test(`${err.message} ${err.responseBody || ''}`);

const publishRasterLayer = async (layer, lang = 'vi') => {
    const config = assertGeoserverConfigured();
    const workspace = config.workspace;
    const storeName = layer.geoserver_store || layer.table_name;
    const sourceUrl = layer.source_url;

    if (!sourceUrl) {
        throw new Error(t('geoserver_raster_source_required', lang));
    }

    // Tạo CoverageStore — store đã tồn tại (retry sau lần publish dở dang) thì bỏ qua
    try {
        await requestGeoserver(`/rest/workspaces/${workspace}/coveragestores`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                coverageStore: {
                    name: storeName,
                    type: 'GeoTIFF',
                    enabled: true,
                    workspace: { name: workspace },
                    url: sourceUrl.startsWith('file://') ? sourceUrl : `file://${sourceUrl}`,
                },
            }),
        });
    } catch (err) {
        if (!isAlreadyExistsError(err)) {
            throw err;
        }
    }

    // Publish coverage từ store
    try {
        await requestGeoserver(
            `/rest/workspaces/${workspace}/coveragestores/${storeName}/coverages`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    coverage: {
                        name: storeName,
                        title: layer.name_vi || storeName,
                        enabled: true,
                    },
                }),
            },
        );
    } catch (err) {
        if (!isAlreadyExistsError(err)) {
            throw err;
        }
    }

    return `${workspace}:${storeName}`;
};
const publishTimelapseLayer = async (layer, lang = 'vi') => {
    const config = assertGeoserverConfigured();
    const workspace = config.workspace;
    const storeName = layer.geoserver_store || layer.table_name;
    const mosaicPath = layer.mosaic_path;

    if (!mosaicPath) {
        throw new Error(t('geoserver_timelapse_mosaic_required', lang));
    }

    const fileUrl = mosaicPath.startsWith('file://') ? mosaicPath : `file://${mosaicPath}`;

    await requestGeoserver(
        `/rest/workspaces/${workspace}/coveragestores/${storeName}/external.imagemosaic`,
        {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain' },
            body: fileUrl,
        },
    );

    return `${workspace}:${storeName}`;
};

const deletePostgisDatastore = async () => {
    const config = assertGeoserverConfigured();
    await requestGeoserver(
        `/rest/workspaces/${encodeURIComponent(config.workspace)}/datastores/${encodeURIComponent(config.datastore)}?recurse=true`,
        { method: 'DELETE' },
    );
};

const deleteWorkspace = async () => {
    const config = assertGeoserverConfigured();
    await requestGeoserver(
        `/rest/workspaces/${encodeURIComponent(config.workspace)}?recurse=true`,
        {
            method: 'DELETE',
        },
    );
};

const createWorkspace = async () => {
    const config = assertGeoserverConfigured();
    await requestGeoserver('/rest/workspaces', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspace: { name: config.workspace } }),
    });
    return config.workspace;
};

const createPostgisDatastore = async ({
    host,
    port = 5432,
    database,
    schema = 'gis',
    user,
    password,
}) => {
    const config = assertGeoserverConfigured();
    if (!host || !database || !user || !password) {
        throw new TypeError('PostGIS datastore connection is incomplete');
    }
    const entries = {
        host,
        port: String(port),
        database,
        schema,
        user,
        passwd: password,
        dbtype: 'postgis',
        'Expose primary keys': 'true',
    };
    await requestGeoserver(`/rest/workspaces/${encodeURIComponent(config.workspace)}/datastores`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            dataStore: {
                name: config.datastore,
                connectionParameters: {
                    entry: Object.entries(entries).map(([key, value]) => ({
                        '@key': key,
                        $: value,
                    })),
                },
            },
        }),
    });
    return config.datastore;
};

const uploadStyle = async (styleName, sldXml) => {
    const config = assertGeoserverConfigured();
    const name = validateResourceName(styleName, 'styleName');
    if (typeof sldXml !== 'string' || !sldXml.includes('StyledLayerDescriptor')) {
        throw new TypeError('SLD XML is invalid');
    }
    await requestGeoserver(
        `/rest/workspaces/${encodeURIComponent(config.workspace)}/styles?name=${encodeURIComponent(name)}`,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/vnd.ogc.sld+xml' },
            body: sldXml,
        },
    );
    return `${config.workspace}:${name}`;
};

const deleteStyle = async (styleName) => {
    const config = assertGeoserverConfigured();
    const name = validateResourceName(styleName, 'styleName');
    await requestGeoserver(
        `/rest/workspaces/${encodeURIComponent(config.workspace)}/styles/${encodeURIComponent(name)}?purge=true`,
        { method: 'DELETE' },
    );
};

const encodeLayerName = (geoserverLayerName) =>
    String(geoserverLayerName)
        .split(':')
        .map((part) => encodeURIComponent(part))
        .join(':');

const unpublishLayer = async (geoserverLayerName) => {
    await requestGeoserver(`/rest/layers/${encodeLayerName(geoserverLayerName)}?recurse=true`, {
        method: 'DELETE',
    });
};

const deleteCoverageStore = async (storeName, purge = 'none') => {
    const config = assertGeoserverConfigured();
    const name = validateResourceName(storeName, 'storeName');
    if (!['none', 'all'].includes(purge)) {
        throw new TypeError('GeoServer coverage-store purge must be none or all');
    }
    await requestGeoserver(
        `/rest/workspaces/${encodeURIComponent(config.workspace)}/coveragestores/` +
            `${encodeURIComponent(name)}?recurse=true&purge=${purge}`,
        { method: 'DELETE' },
    );
};

const setLayerEnabled = async (geoserverLayerName, enabled) => {
    await requestGeoserver(`/rest/layers/${encodeLayerName(geoserverLayerName)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ layer: { enabled } }),
    });
};

const verifyLayer = async (geoserverLayerName) => {
    const response = await requestGeoserver(
        `/rest/layers/${encodeLayerName(geoserverLayerName)}.json`,
    );
    const body = await response.json();
    if (!body?.layer?.name) {
        throw new GeoServerError(
            'GeoServer layer verification returned an invalid payload',
            502,
            '',
        );
    }
    return body.layer;
};

const truncateGwcLayer = async (
    geoserverLayerName,
    format = 'image/png',
    zoomStart = 0,
    zoomStop = 16,
) => {
    await requestGeoserver(`/gwc/rest/seed/${encodeURIComponent(geoserverLayerName)}.json`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            seedRequest: {
                name: geoserverLayerName,
                type: 'truncate',
                zoomStart,
                zoomStop,
                format,
            },
        }),
    });
};

/**
 * Publish 1 GeoTIFF nằm trên MinIO/S3 qua CoverageStore type `S3GeoTiff`.
 * Yêu cầu extension `gs-s3-geotiff` đã cài trên GeoServer + file properties
 * `.s3.properties` trong GEOSERVER_DATA_DIR trỏ endpoint MinIO nếu không phải AWS.
 *
 * @param {object} args
 * @param {string} args.storeName    — tên CoverageStore + Coverage (thường trùng)
 * @param {string} args.s3Bucket
 * @param {string} args.s3Key
 * @param {string} args.title
 * @param {boolean} [args.enabled]
 * @returns {Promise<string>} — 'workspace:storeName'
 */
const publishS3GeoTiffLayer = async ({ storeName, s3Bucket, s3Key, title, enabled = true }) => {
    const config = assertGeoserverConfigured();
    const workspace = config.workspace;
    const s3Url = `s3://${s3Bucket}/${s3Key}`;
    const t0 = Date.now();
    const dbg =
        process.env.RASTER_INGEST_DEBUG === 'true' || process.env.NODE_ENV === 'development'
            ? (msg) => console.debug(`[GEOSERVER-S3] ${msg}`)
            : () => {};

    dbg(`publish store=${storeName} ws=${workspace} url=${s3Url}`);

    // 1. CoverageStore. Upsert: POST tạo mới, nếu đã tồn tại thì PUT cập nhật
    // URL — cần thiết cho re-ingest (URL S3 có thể trỏ file khác) — nếu bỏ qua,
    // GeoServer sẽ serve raster cũ mãi mãi.
    const storeBody = JSON.stringify({
        coverageStore: {
            name: storeName,
            type: 'S3GeoTiff',
            enabled,
            workspace: { name: workspace },
            url: s3Url,
        },
    });

    try {
        await requestGeoserver(`/rest/workspaces/${workspace}/coveragestores`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: storeBody,
        });
        dbg(`store CREATED (POST)`);
    } catch (err) {
        if (!isAlreadyExistsError(err)) {
            console.error(
                `[GEOSERVER-S3] store CREATE FAILED store=${storeName} status=${err.status}: ${err.message}`,
            );
            throw err;
        }
        // Đã tồn tại → PUT cập nhật URL. GeoServer trả 200 kể cả khi URL trùng.
        dbg(`store exists → PUT update URL`);
        await requestGeoserver(`/rest/workspaces/${workspace}/coveragestores/${storeName}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: storeBody,
        });
        dbg(`store URL UPDATED (PUT)`);
    }

    // 2. Coverage.
    const coverageBody = JSON.stringify({
        coverage: {
            name: storeName,
            title: title || storeName,
            enabled,
        },
    });
    try {
        await requestGeoserver(
            `/rest/workspaces/${workspace}/coveragestores/${storeName}/coverages`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: coverageBody,
            },
        );
        dbg(`coverage CREATED`);
    } catch (err) {
        if (!isAlreadyExistsError(err)) {
            console.error(
                `[GEOSERVER-S3] coverage CREATE FAILED store=${storeName} status=${err.status}: ${err.message}`,
            );
            throw err;
        }
        await requestGeoserver(
            `/rest/workspaces/${workspace}/coveragestores/${storeName}/coverages/${storeName}`,
            {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: coverageBody,
            },
        );
        dbg(`coverage UPDATED`);
    }

    const layerName = `${workspace}:${storeName}`;
    dbg(`done → ${layerName} (${Date.now() - t0}ms)`);
    return layerName;
};

const publishGeoTiffStream = async ({ storeName, stream }) => {
    const config = assertGeoserverConfigured();
    const workspace = config.workspace;
    const name = validateResourceName(storeName, 'storeName');
    if (!stream || typeof stream.pipe !== 'function') {
        throw new TypeError('GeoTIFF stream is required');
    }
    await requestGeoserver(
        `/rest/workspaces/${workspace}/coveragestores/${name}/file.geotiff?configure=first&coverageName=${encodeURIComponent(name)}`,
        {
            method: 'PUT',
            headers: { 'Content-Type': 'image/tiff' },
            body: stream,
        },
    );
    const layerName = `${workspace}:${name}`;
    await verifyLayer(layerName);
    return layerName;
};

const imageMosaicPath = (workspace, storeName, coverageName = null) => {
    const base =
        `/rest/workspaces/${encodeURIComponent(workspace)}/coveragestores/` +
        `${encodeURIComponent(storeName)}`;
    return coverageName ? `${base}/coverages/${encodeURIComponent(coverageName)}` : base;
};

const uploadImageMosaicZip = async ({ storeName, archivePath, timeoutMs = 30 * 60 * 1000 }) => {
    const fs = require('fs');
    const config = assertGeoserverConfigured();
    const workspace = config.workspace;
    const name = validateResourceName(storeName, 'storeName');
    const stat = await fs.promises.stat(archivePath);
    await requestGeoserver(`${imageMosaicPath(workspace, name)}/file.imagemosaic`, {
        method: 'PUT',
        headers: {
            'Content-Type': 'application/zip',
            'Content-Length': String(stat.size),
        },
        body: fs.createReadStream(archivePath),
        timeoutMs,
    });
    const layerName = `${workspace}:${name}`;
    await verifyLayer(layerName);
    return layerName;
};

const configureCoverageTime = async ({ storeName, coverageName = storeName }) => {
    const config = assertGeoserverConfigured();
    const store = validateResourceName(storeName, 'storeName');
    const coverage = validateResourceName(coverageName, 'coverageName');
    await requestGeoserver(imageMosaicPath(config.workspace, store, coverage), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            coverage: {
                metadata: {
                    entry: [
                        {
                            '@key': 'time',
                            dimensionInfo: {
                                enabled: true,
                                attribute: 'ingestion',
                                presentation: 'LIST',
                                units: 'ISO8601',
                                defaultValue: { strategy: 'MAXIMUM' },
                                nearestMatchEnabled: false,
                                rawNearestMatchEnabled: false,
                            },
                        },
                    ],
                },
            },
        }),
    });
};

const metadataEntries = (metadata) => {
    const entry = metadata?.entry;
    if (!entry) {
        return [];
    }
    return Array.isArray(entry) ? entry : [entry];
};

const verifyImageMosaicTime = async ({ storeName, coverageName = storeName }) => {
    const config = assertGeoserverConfigured();
    const store = validateResourceName(storeName, 'storeName');
    const coverage = validateResourceName(coverageName, 'coverageName');
    const response = await requestGeoserver(
        `${imageMosaicPath(config.workspace, store, coverage)}.json`,
    );
    const body = await response.json();
    const timeEntry = metadataEntries(body?.coverage?.metadata).find(
        (entry) => entry?.['@key'] === 'time',
    );
    const info = timeEntry?.dimensionInfo;
    if (
        info?.enabled !== true ||
        info?.attribute !== 'ingestion' ||
        info?.presentation !== 'LIST' ||
        info?.defaultValue?.strategy !== 'MAXIMUM'
    ) {
        throw new GeoServerError('GeoServer TIME dimension verification failed', 502, '');
    }
    return info;
};

/**
 * Publish 1 GeoTIFF nằm trên filesystem (đã copy vào GEOSERVER_DATA_DIR
 * hoặc path GeoServer đọc được) qua CoverageStore type `GeoTIFF` — dùng cho
 * môi trường không có community extension `gs-s3-geotiff` (VD GeoServer 3.0.0
 * chưa port module).
 *
 * @param {object}  args
 * @param {string}  args.storeName
 * @param {string}  args.filePath   — path tuyệt đối tới .tif trên đĩa
 * @param {string}  args.title
 * @param {boolean} [args.enabled]
 * @returns {Promise<string>} — 'workspace:storeName'
 */
const publishFsGeoTiffLayer = async ({ storeName, filePath, title, enabled = true }) => {
    const config = assertGeoserverConfigured();
    const workspace = config.workspace;
    // pathToFileURL xử lý drive letter + backslash trên Windows đúng chuẩn
    // (file:///C:/... thay vì file:C:\... — cái sau GeoServer từng parse sai).
    const { pathToFileURL } = require('url');
    const fileUrl = pathToFileURL(filePath).href;
    const t0 = Date.now();
    const dbg =
        process.env.RASTER_INGEST_DEBUG === 'true' || process.env.NODE_ENV === 'development'
            ? (msg) => console.debug(`[GEOSERVER-FS] ${msg}`)
            : () => {};

    dbg(`publish store=${storeName} ws=${workspace} url=${fileUrl}`);

    const storeBody = JSON.stringify({
        coverageStore: {
            name: storeName,
            type: 'GeoTIFF',
            enabled,
            workspace: { name: workspace },
            url: fileUrl,
        },
    });

    try {
        await requestGeoserver(`/rest/workspaces/${workspace}/coveragestores`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: storeBody,
        });
        dbg('store CREATED (POST)');
    } catch (err) {
        if (!isAlreadyExistsError(err)) {
            console.error(
                `[GEOSERVER-FS] store CREATE FAILED store=${storeName} status=${err.status}: ${err.message}`,
            );
            throw err;
        }
        dbg('store exists → PUT update URL');
        await requestGeoserver(`/rest/workspaces/${workspace}/coveragestores/${storeName}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: storeBody,
        });
        dbg('store URL UPDATED (PUT)');
    }

    try {
        await requestGeoserver(
            `/rest/workspaces/${workspace}/coveragestores/${storeName}/coverages`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    coverage: { name: storeName, title: title || storeName, enabled },
                }),
            },
        );
        dbg('coverage CREATED');
    } catch (err) {
        if (!isAlreadyExistsError(err)) {
            console.error(
                `[GEOSERVER-FS] coverage CREATE FAILED store=${storeName} status=${err.status}: ${err.message}`,
            );
            throw err;
        }
        dbg('coverage already exists — kept');
    }

    const layerName = `${workspace}:${storeName}`;
    dbg(`done → ${layerName} (${Date.now() - t0}ms)`);
    return layerName;
};

const harvestGeoTiff = async (coverageStore, tifPath) => {
    const config = assertGeoserverConfigured();
    const fileUrl = tifPath.startsWith('file://') ? tifPath : `file://${tifPath}`;

    await requestGeoserver(
        `/rest/workspaces/${config.workspace}/coveragestores/${coverageStore}/external.imagemosaic`,
        {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain' },
            body: fileUrl,
        },
    );
};

const healthCheck = async () => {
    try {
        assertGeoserverConfigured();
        await requestGeoserver('/rest/workspaces.json');
        return true;
    } catch {
        return false;
    }
};

module.exports = {
    GeoServerError,
    requestGeoserver,
    createWorkspace,
    deleteWorkspace,
    createPostgisDatastore,
    deletePostgisDatastore,
    uploadStyle,
    deleteStyle,
    publishVectorLayer,
    publishRasterLayer,
    publishS3GeoTiffLayer,
    publishGeoTiffStream,
    uploadImageMosaicZip,
    configureCoverageTime,
    verifyImageMosaicTime,
    publishFsGeoTiffLayer,
    publishTimelapseLayer,
    unpublishLayer,
    deleteCoverageStore,
    setLayerEnabled,
    verifyLayer,
    truncateGwcLayer,
    harvestGeoTiff,
    // Health
    healthCheck,
};
