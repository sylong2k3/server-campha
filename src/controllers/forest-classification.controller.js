'use strict';

const forest = require('../services/forest-classification.service');
const snapshots = require('../repositories/forest-classification.repository');
const gt = require('../repositories/forest-gt.repository');
const ingest = require('../services/raster-ingest.service');
const { buildGeeProcessingState } = require('../utils/gee-processing-state.util');
const { OK, OK_LIST, CREATED } = require('../core/success.response');
const { Api400Error, Api404Error } = require('../core/error.response');
const debug = require('../services/forest-classification/debug.util');
const { buildPeriodLayerCode } = require('../services/forest-classification/archive');

const CLASS_MIN = 0;
const CLASS_MAX = 12;

const positiveInteger = (value, fallback, max = 100) => {
    const parsed = Number.parseInt(value, 10);
    return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, max) : fallback;
};

const validPeriod = (year, month) => {
    const now = new Date();
    return (
        Number.isInteger(year) &&
        Number.isInteger(month) &&
        year >= 1984 &&
        year <= now.getUTCFullYear() &&
        month >= 1 &&
        month <= 12 &&
        !(year === now.getUTCFullYear() && month > now.getUTCMonth() + 1)
    );
};

const formatSnapshot = (snapshot) => {
    if (!snapshot) {
        return null;
    }
    return {
        id: snapshot.id,
        year: snapshot.year,
        month: snapshot.month,
        attempt: snapshot.attempt,
        status: snapshot.status,
        provinceSummary: snapshot.province_summary || null,
        districtExportSummary: snapshot.district_export_summary || null,
        oobAccuracy: snapshot.oob_accuracy === null ? null : Number(snapshot.oob_accuracy),
        testKappa: snapshot.test_kappa === null ? null : Number(snapshot.test_kappa),
        geoserverLayer: snapshot.geoserver_layer || null,
        geeTileUrl: snapshot.gee_tile_url || null,
        geeTileGeneratedAt: snapshot.gee_tile_generated_at || null,
        geeDownloadUrl: snapshot.gee_download_url || null,
        downloadFilename: `forest_classification_${snapshot.year}_${String(snapshot.month).padStart(2, '0')}.tif`,
        computedAt: snapshot.computed_at || null,
        errorMessage: snapshot.error_message || null,
        retryCount: Number(snapshot.retry_count || 0),
        nextRetryAt: snapshot.next_retry_at || null,
        lastRetryError: snapshot.last_retry_error || null,
    };
};

const processing = (snapshot, taskKey = null) =>
    buildGeeProcessingState({ pipeline: 'forest-classification', snapshot, taskKey });

const getLatest = async (req, res) => {
    const data = await forest.getLatest();
    OK(res, 'Lấy kết quả phân loại rừng thành công.', {
        snapshot: formatSnapshot(data.snapshot),
        comparison: data.comparison,
        stale: data.stale,
        computing: data.computing,
        processing: processing(data.processingSnapshot),
    });
};

const getHistory = async (req, res) => {
    const page = positiveInteger(req.query.page, 1);
    const limit = positiveInteger(req.query.limit, 24);
    const { items, total } = await forest.listRuns({ page, limit });
    OK_LIST(res, 'Danh sách kỳ phân loại rừng.', items, { page, limit, total });
};

const getPublishedHistory = async (req, res) => {
    const page = positiveInteger(req.query.page, 1);
    const limit = positiveInteger(req.query.limit, 24);
    const { items, total } = await forest.listRuns({ page, limit, publishedOnly: true });
    OK_LIST(res, 'Danh sách kỳ phân loại đã công bố.', items, { page, limit, total });
};

const refresh = async (req, res) => {
    const now = new Date();
    const year =
        req.body?.year === undefined || req.body?.year === null
            ? now.getUTCFullYear()
            : Number(req.body.year);
    const month =
        req.body?.month === undefined || req.body?.month === null
            ? now.getUTCMonth() + 1
            : Number(req.body.month);
    if (!validPeriod(year, month)) {
        throw new Api400Error('Kỳ phân tích không hợp lệ.', ['INVALID_ANALYSIS_PERIOD']);
    }
    debug.log('controller.refresh received', {
        year,
        month,
        requestedBy: req.user?.id || null,
        ip: req.ip,
    });
    const run = await forest.requestRun({
        year,
        month,
        trigger: 'manual',
        requestedBy: req.user?.id,
    });
    debug.log('controller.refresh response', {
        snapshotId: run?.snapshot?.id,
        deduplicated: run?.deduplicated,
    });
    return res.status(202).json({
        message: run.deduplicated
            ? 'Kỳ phân loại này đang được xử lý.'
            : 'Đã tiếp nhận yêu cầu phân loại rừng.',
        status: 202,
        data: {
            run: {
                year,
                month,
                status: 'queued',
                deduplicated: run.deduplicated,
                processing: processing(run.snapshot, run.taskKey),
            },
        },
    });
};

const queryPeriod = async (req, res) => {
    const year = Number(req.body?.year);
    const month = Number(req.body?.month);
    if (!validPeriod(year, month)) {
        throw new Api400Error('year và month không hợp lệ.', ['INVALID_ANALYSIS_PERIOD']);
    }
    debug.log('controller.queryPeriod received', {
        year,
        month,
        requestedBy: req.user?.id || null,
    });
    const data = await forest.queryPeriod(year, month, req.user?.id || null);
    debug.log('controller.queryPeriod response', {
        snapshotId: data?.snapshot?.id,
        cached: data?.cached,
        computing: data?.computing,
    });
    OK(res, data.cached ? 'Lấy kết quả phân loại rừng thành công.' : 'Đang xử lý phân loại rừng.', {
        snapshot: formatSnapshot(data.snapshot),
        comparison: data.comparison,
        cached: data.cached,
        computing: data.computing,
        processing: processing(data.snapshot),
    });
};

const getSnapshot = async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
        throw new Api400Error('ID kết quả không hợp lệ.', ['INVALID_ID']);
    }
    const data = await forest.getSnapshot(id);
    if (!data) {
        throw new Api404Error('Không tìm thấy kết quả phân loại rừng.', [
            'FOREST_SNAPSHOT_NOT_FOUND',
        ]);
    }
    OK(res, 'Lấy kết quả phân loại rừng thành công.', {
        snapshot: formatSnapshot(data.snapshot),
        comparison: data.comparison,
        computing: forest.activeStatuses.has(data.snapshot.status),
        processing: processing(data.snapshot),
    });
};

const publishRaster = async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
        throw new Api400Error('ID kết quả không hợp lệ.', ['INVALID_ID']);
    }
    debug.log('controller.publishRaster received', {
        snapshotId: id,
        force: req.query?.force === '1',
        requestedBy: req.user?.id || null,
    });
    const snapshot = await snapshots.getById(id);
    if (!snapshot) {
        throw new Api404Error('Không tìm thấy kết quả phân loại rừng.', [
            'FOREST_SNAPSHOT_NOT_FOUND',
        ]);
    }
    if (!['completed', 'published'].includes(snapshot.status)) {
        throw new Api400Error('Kết quả chưa hoàn tất nên chưa thể công bố.', ['RESULT_NOT_READY']);
    }
    const latestSuccessful = await snapshots.getLatestSuccessfulByPeriod(
        snapshot.year,
        snapshot.month,
    );
    if (!latestSuccessful || Number(latestSuccessful.id) !== id) {
        throw new Api400Error('Chỉ có thể công bố kết quả thành công mới nhất của kỳ.', [
            'NOT_LATEST_SUCCESSFUL_RESULT',
        ]);
    }
    if (snapshot.geoserver_layer && req.query.force !== '1') {
        return OK(res, 'Kết quả đã được công bố trên bản đồ.', {
            snapshotId: id,
            geoserverLayer: snapshot.geoserver_layer,
            alreadyPublished: true,
        });
    }
    if (!snapshot.gee_download_url) {
        throw new Api400Error('Kết quả chưa có URL GeoTIFF để publish.', ['NO_DOWNLOAD_URL']);
    }
    const layerCode = buildPeriodLayerCode(snapshot.year, snapshot.month);
    const { job, deduplicated } = await ingest.enqueue({
        sourceUrl: snapshot.gee_download_url,
        layerCode,
        nameVi: `Phân loại rừng ${snapshot.year}-${snapshot.month}`,
        category: 'forest',
        isPublic: true,
        requestParams: {
            bucketCategory: 'raster',
            publishCategory: 'raster',
            objectKeyTag: 'latest',
            objectKeyYear: snapshot.year,
            objectKeyMonth: snapshot.month,
            data_year: snapshot.year,
            linkedResource: { type: 'forest_snapshot', id },
        },
        user: req.user,
        lang: req.lang,
    });
    CREATED(res, 'Đã tiếp nhận yêu cầu publish kết quả phân loại.', {
        snapshotId: id,
        jobId: job.id,
        status: job.status,
        layerCode,
        deduplicated: Boolean(deduplicated),
    });
};

const parseGtQuery = (query, limitDefault) => ({
    page: positiveInteger(query.page, 1),
    limit: positiveInteger(query.limit, limitDefault),
    from: query.from || null,
    to: query.to || null,
    classId:
        query.classId === undefined || query.classId === null || query.classId === ''
            ? null
            : Number(query.classId),
});

const validateClass = (classId) => {
    const value = Number(classId);
    if (!Number.isInteger(value) || value < CLASS_MIN || value > CLASS_MAX) {
        throw new Api400Error('classId phải là số nguyên từ 0 đến 12.', ['INVALID_CLASS_ID']);
    }
    return value;
};

const validateObservedAt = (value) => {
    if (!value || Number.isNaN(Date.parse(value))) {
        throw new Api400Error('observedAt không hợp lệ.', ['INVALID_OBSERVED_AT']);
    }
    return value;
};

const zoneGeometry = (geom) => {
    if (!['Polygon', 'MultiPolygon'].includes(geom?.type) || !Array.isArray(geom.coordinates)) {
        throw new Api400Error('geom phải là GeoJSON Polygon hoặc MultiPolygon.', [
            'INVALID_GEOMETRY',
        ]);
    }
    return geom.type === 'Polygon'
        ? { type: 'MultiPolygon', coordinates: [geom.coordinates] }
        : geom;
};

const listZones = async (req, res) => {
    const query = parseGtQuery(req.query, 50);
    if (query.classId !== null) {
        validateClass(query.classId);
    }
    const { items, total } = await gt.listZones(query);
    OK_LIST(res, 'Danh sách vùng mẫu.', items, { ...query, total });
};

const createZone = async (req, res) => {
    const body = req.body || {};
    const zone = await gt.insertZone({
        name: body.name,
        observedAt: validateObservedAt(body.observedAt),
        classId: validateClass(body.classId),
        source: body.source,
        geom: zoneGeometry(body.geom),
        notes: body.notes,
        createdBy: req.user?.id,
    });
    CREATED(res, 'Đã thêm vùng mẫu.', zone);
};

const bulkZone = async (req, res) => {
    const features = req.body?.features;
    if (!Array.isArray(features) || !features.length) {
        throw new Api400Error('FeatureCollection rỗng.', ['EMPTY_FEATURE_COLLECTION']);
    }
    if (features.length > 500) {
        throw new Api400Error('Tối đa 500 vùng mẫu mỗi lần.', ['BULK_LIMIT']);
    }
    features.forEach((feature) => {
        zoneGeometry(feature.geometry);
        validateClass(
            feature.properties?.classId ??
                feature.properties?.class_id ??
                feature.properties?.class,
        );
    });
    const result = await gt.insertZones(features, req.user?.id);
    CREATED(res, `Đã thêm ${result.inserted} vùng mẫu.`, result);
};

const deleteZone = async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || !(await gt.disableZone(id))) {
        throw new Api404Error('Không tìm thấy vùng mẫu.', ['ZONE_NOT_FOUND']);
    }
    OK(res, 'Đã xóa vùng mẫu.', { deleted: true, id });
};

const listPoints = async (req, res) => {
    const query = parseGtQuery(req.query, 100);
    if (query.classId !== null) {
        validateClass(query.classId);
    }
    const { items, total } = await gt.listPoints(query);
    OK_LIST(res, 'Danh sách điểm mẫu.', items, { ...query, total });
};

const pointPayload = (body, user) => {
    const lng = Number(body.lng);
    const lat = Number(body.lat);
    if (
        !Number.isFinite(lng) ||
        !Number.isFinite(lat) ||
        lng < 106 ||
        lng > 109 ||
        lat < 20 ||
        lat > 22.5
    ) {
        throw new Api400Error('Tọa độ điểm mẫu không hợp lệ.', ['INVALID_COORDINATE']);
    }
    return {
        observedAt: validateObservedAt(body.observedAt),
        classId: validateClass(body.classId),
        lng,
        lat,
        source: body.source,
        photoUrl: body.photoUrl,
        reporterName: body.reporterName,
        notes: body.notes,
        createdBy: user?.id,
    };
};

const createPoint = async (req, res) =>
    CREATED(res, 'Đã thêm điểm mẫu.', await gt.insertPoint(pointPayload(req.body || {}, req.user)));

const bulkPoint = async (req, res) => {
    const points = req.body?.points;
    if (!Array.isArray(points) || !points.length) {
        throw new Api400Error('Danh sách điểm mẫu rỗng.', ['EMPTY_POINTS']);
    }
    if (points.length > 1000) {
        throw new Api400Error('Tối đa 1.000 điểm mẫu mỗi lần.', ['BULK_LIMIT']);
    }
    points.forEach((point) => pointPayload(point, req.user));
    const result = await gt.insertPoints(points, req.user?.id);
    CREATED(res, `Đã thêm ${result.inserted} điểm mẫu.`, result);
};

const deletePoint = async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || !(await gt.disablePoint(id))) {
        throw new Api404Error('Không tìm thấy điểm mẫu.', ['POINT_NOT_FOUND']);
    }
    OK(res, 'Đã xóa điểm mẫu.', { deleted: true, id });
};

module.exports = {
    getLatest,
    getHistory,
    getPublishedHistory,
    refresh,
    queryPeriod,
    getSnapshot,
    publishRaster,
    listZones,
    createZone,
    bulkZone,
    deleteZone,
    listPoints,
    createPoint,
    bulkPoint,
    deletePoint,
};
