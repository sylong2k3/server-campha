'use strict';

const crypto = require('crypto');
const runRepo = require('../../repositories/flood-analysis-run.repository');
const artifactRepo = require('../../repositories/flood-artifact.repository');
const ingestRepo = require('../../repositories/raster-ingest.repository');
const layerRepo = require('../../repositories/layer.repository');
const floodScenarioRepo = require('../../repositories/flood-scenario.repository');
const webMapService = require('../web-map.service');
const orchestrator = require('./orchestrator.service');
const geeAdapter = require('../gee-earth-engine.adapter');
const rasterIngest = require('../raster-ingest.service');
const minio = require('../minio.service');
const geoserver = require('../../utils/geoserver.client');
const { canManuallyPublish } = require('./config/product-vs-calibration');
const { validateRunConfig } = require('./config/schema');
const defaults = require('./config/defaults');
const versions = require('./config/versions');
const { buildAllLegends, buildAllAdminLegends } = require('./visualization/legends');
const legendStore = require('./visualization/legend-store');
const { ARTIFACT_LAYER_DEFINITIONS } = require('./visualization/layer-definitions');
const { Api400Error, Api403Error, Api404Error, Api409Error } = require('../../core/error.response');
const debug = require('./debug.util');

function canonical(value) {
    if (Array.isArray(value)) {
        return value.map(canonical);
    }
    if (value && typeof value === 'object') {
        return Object.fromEntries(
            Object.keys(value)
                .sort()
                .map((key) => [key, canonical(value[key])]),
        );
    }
    return value;
}

function analysisKey(module, config) {
    return crypto
        .createHash('sha256')
        .update(JSON.stringify(canonical({ module, config })))
        .digest('hex');
}

function actorFields(actor) {
    return {
        actorUserId: actor?.id || actor?.userId || null,
        ip: actor?.ip || actor?.ipAddress || null,
        userAgent: actor?.userAgent || null,
    };
}

async function ensureRunAdmissible(key) {
    const active = await runRepo.findActiveByAnalysisKey(key);
    if (active) {
        throw new Api409Error(`An equivalent ${active.module} run is already active`, [
            'FLOOD_RUN_ALREADY_ACTIVE',
        ]);
    }
    orchestrator.preflightRun(key);
}

async function createRun(payload) {
    try {
        return await runRepo.create(payload);
    } catch (error) {
        if (error?.code === '23505') {
            throw new Api409Error('An equivalent flood run is already active', [
                'FLOOD_RUN_ALREADY_ACTIVE',
            ]);
        }
        throw error;
    }
}

async function submit({ module, config = {}, mode = 'product' }, actor) {
    debug.log('analysis.submit received', {
        module,
        mode,
        actorId: actor?.id || actor?.userId || null,
        configKeys: Object.keys(config || {}),
    });
    if (mode === 'calibration' && actor?.permissions?.flood?.calibrate !== true) {
        debug.log('analysis.submit rejected: calibration forbidden', {
            module,
            actorId: actor?.id,
        });
        throw new Api403Error('Flood calibration permission is required', [
            'FLOOD_CALIBRATION_FORBIDDEN',
        ]);
    }
    // When module is 'trend' and analysisYear is present, validate against the
    // FINAL schema and stamp TREND_FINAL pipeline version. V1 trend (periods-based)
    // continues to use the 'trend' schema key unchanged.
    const schemaKey = module === 'trend' && config?.analysisYear !== undefined
        ? 'trendFinal'
        : module;
    let normalized;
    try {
        normalized = validateRunConfig(schemaKey, { ...config, mode });
    } catch (error) {
        debug.logError('analysis.submit validation failed', error, { module, schemaKey });
        throw new Api400Error(error.message, ['INVALID_FLOOD_CONFIG']);
    }
    const key = analysisKey(module, normalized);
    debug.log('analysis.submit config validated', { module, schemaKey, analysisKey: key });
    await ensureRunAdmissible(key);
    const run = await createRun({
        analysisKey: key,
        attemptNo: await runRepo.nextAttemptNo(key),
        module,
        mode: normalized.mode,
        pipelineVersion: versions.pipelineVersionFor(schemaKey),
        configVersion: versions.CONFIG_VERSION,
        paramsSnapshot: normalized,
        aoiSource: 'REFERENCE_GAUL',
        startedBy: actor?.id || actor?.userId || null,
    });
    debug.log('analysis.submit run row created', {
        runId: run.id,
        module: run.module,
        mode: run.mode,
        attemptNo: run.attempt_no,
        pipelineVersion: run.pipeline_version,
    });
    await runRepo.insertAudit({
        analysisRunId: run.id,
        action: 'submit',
        metadata: { module, mode: normalized.mode, analysisKey: key },
        ...actorFields(actor),
    });
    orchestrator.enqueueRun(run);
    debug.log('analysis.submit enqueued', { runId: run.id });
    return run;
}

async function rerun(id, actor) {
    const source = await getRun(id);
    if (source.mode === 'calibration' && actor?.permissions?.flood?.calibrate !== true) {
        throw new Api403Error('Flood calibration permission is required', [
            'FLOOD_CALIBRATION_FORBIDDEN',
        ]);
    }
    await ensureRunAdmissible(source.analysis_key);
    const run = await createRun({
        analysisKey: source.analysis_key,
        attemptNo: await runRepo.nextAttemptNo(source.analysis_key),
        module: source.module,
        mode: source.mode,
        pipelineVersion: source.pipeline_version,
        configVersion: source.config_version,
        paramsSnapshot: source.params_snapshot,
        aoiSource: source.aoi_source,
        startedBy: actor?.id || actor?.userId || null,
    });
    await runRepo.insertAudit({
        analysisRunId: run.id,
        action: 'rerun',
        metadata: { sourceRunId: source.id },
        ...actorFields(actor),
    });
    orchestrator.enqueueRun(run);
    return run;
}

async function cancel(id, actor) {
    const run = await getRun(id);
    if (runRepo.TERMINAL_STATUSES.includes(run.status)) {
        throw new Api409Error('A terminal flood run cannot be cancelled', ['FLOOD_RUN_TERMINAL']);
    }
    for (const taskName of Object.values(run.gee_task_ids || {})) {
        await geeAdapter.cancelOperation(taskName).catch(() => {});
    }
    const cancelled = await runRepo.finishRun(id, { status: 'CANCELLED' });
    await runRepo.insertAudit({
        analysisRunId: id,
        action: 'cancel',
        metadata: { previousStatus: run.status },
        ...actorFields(actor),
    });
    return cancelled;
}

async function getRun(id) {
    const run = await runRepo.findById(id);
    if (!run) {
        throw new Api404Error('Flood run not found', ['FLOOD_RUN_NOT_FOUND']);
    }
    return run;
}

async function getRunDetail(id) {
    const run = await getRun(id);
    const [artifacts, stages] = await Promise.all([
        artifactRepo.listByRunId(id),
        runRepo.listStageEvents(id),
    ]);
    return { ...run, artifacts, stages };
}

async function listRuns(query = {}) {
    const limit = Math.min(Math.max(Number(query.limit) || 20, 1), 100);
    const page = Math.max(Number(query.page) || 1, 1);
    return runRepo.list({
        module: query.module,
        mode: query.mode,
        status: query.status,
        from: query.from,
        to: query.to,
        startedBy: query.startedBy,
        limit,
        offset: (page - 1) * limit,
    });
}

function publicArtifact(artifact) {
    return {
        id: artifact.id,
        analysisRunId: artifact.analysis_run_id,
        module: artifact.module,
        code: artifact.artifact_code,
        role: artifact.artifact_role,
        crs: artifact.crs,
        bbox: artifact.bbox,
        resolutionM: artifact.resolution_m,
        registryLayerId: artifact.registry_layer_id,
        isPublic: artifact.registry_is_public === true,
        workspace: artifact.workspace,
        layerName: artifact.layer_name,
        styleName: artifact.style_name,
        publishedAt: artifact.published_at,
        metadata: artifact.metadata,
    };
}

async function listPublished(query = {}) {
    const limit = Math.min(Math.max(Number(query.limit) || 50, 1), 100);
    const page = Math.max(Number(query.page) || 1, 1);
    const result = await artifactRepo.listPublished({
        module: query.module,
        from: query.from,
        to: query.to,
        limit,
        offset: (page - 1) * limit,
    });
    return { ...result, items: result.items.map(publicArtifact) };
}

/**
 * Extract a concise period summary from result_metadata so clients can display
 * the analysis window without accessing the full params_snapshot.
 */
function extractRunPeriod(run) {
    const m = run.result_metadata || {};
    switch (run.module) {
        case 'event':
        case 'impact':
            return m.postStart ? { start: m.postStart, end: m.postEnd || null } : null;
        case 'hand':
            return m.levelM != null ? { levelM: m.levelM } : null;
        case 'trend':
            return m.baselinePeriod || m.analysisPeriods
                ? { baseline: m.baselinePeriod || null, analysis: m.analysisPeriods || null }
                : null;
        default:
            return null;
    }
}

async function listPublicRuns(query = {}) {
    const result = await listRuns({ ...query, mode: 'product', status: 'SUCCEEDED' });
    return {
        ...result,
        items: result.items.map((run) => ({
            id: run.id,
            module: run.module,
            mode: run.mode,
            status: run.status,
            pipelineVersion: run.pipeline_version,
            resultMetadata: run.result_metadata,
            period: extractRunPeriod(run),
            warnings: run.warnings,
            finishedAt: run.finished_at,
        })),
    };
}

async function publishArtifact(id, actor) {
    const artifact = await artifactRepo.findById(id);
    if (!artifact) {
        throw new Api404Error('Flood artifact not found', ['FLOOD_ARTIFACT_NOT_FOUND']);
    }
    if (!canManuallyPublish(artifact)) {
        throw new Api409Error(
            'Calibration artifacts cannot be published directly; create a product rerun',
            ['CALIBRATION_PUBLICATION_FORBIDDEN'],
        );
    }
    if (!artifact.minio_object_key || !artifact.minio_bucket) {
        throw new Api409Error('Artifact has no durable MinIO archive', ['FLOOD_ARCHIVE_NOT_READY']);
    }
    const previousJob = artifact.ingest_job_id
        ? await ingestRepo.findById(artifact.ingest_job_id)
        : null;
    const signed = await minio.getPresignedDownloadUrl({
        objectKey: artifact.minio_object_key,
        category: artifact.minio_bucket,
        expireSeconds: 3600,
    });
    const enqueued = await rasterIngest.enqueue({
        sourceUrl: signed.url,
        sourceKind: 'gee_download_url',
        layerCode:
            previousJob?.layer_code ||
            `fl_${artifact.module}_${artifact.artifact_code}_${artifact.id}`,
        nameVi: artifact.metadata?.label?.vi || artifact.artifact_code,
        nameEn: artifact.metadata?.label?.en || artifact.artifact_code,
        isPublic: true,
        category: 'flood',
        user: { id: actor?.id || actor?.userId },
        requestParams: {
            ...(previousJob?.request_params || {}),
            publish: true,
            bucketCategory: artifact.minio_bucket,
            linkedResource: { type: 'flood_artifact', id: artifact.id },
        },
    });
    await artifactRepo.setPublishing(artifact.id);
    await artifactRepo.updateAssetMetadata(artifact.id, { ingestJobId: enqueued.job.id });
    await runRepo.insertAudit({
        analysisRunId: artifact.analysis_run_id,
        artifactId: artifact.id,
        action: artifact.publish_status === 'failed' ? 'retry_publish' : 'publish',
        metadata: { ingestJobId: enqueued.job.id },
        ...actorFields(actor),
    });
    return { artifactId: artifact.id, ingestJob: enqueued.job };
}

async function unpublishArtifact(id, actor) {
    const artifact = await artifactRepo.findById(id);
    if (!artifact) {
        throw new Api404Error('Flood artifact not found', ['FLOOD_ARTIFACT_NOT_FOUND']);
    }
    if (artifact.workspace && artifact.layer_name) {
        await geoserver.unpublishLayer(`${artifact.workspace}:${artifact.layer_name}`);
    }
    const job = artifact.ingest_job_id ? await ingestRepo.findById(artifact.ingest_job_id) : null;
    if (job?.layer_id) {
        await layerRepo.setPublishState(job.layer_id, 'unpublished');
    }
    const updated = await artifactRepo.setUnpublished(id);
    await runRepo.insertAudit({
        analysisRunId: artifact.analysis_run_id,
        artifactId: artifact.id,
        action: 'unpublish',
        metadata: {},
        ...actorFields(actor),
    });
    return updated;
}

async function overview({ mode = 'product', onlySucceeded = true } = {}) {
    const modules = ['event', 'impact', 'trend'];
    const latest = await Promise.all(
        modules.map((module) =>
            runRepo.findLatestByModule(module, {
                mode,
                onlySucceeded,
            }),
        ),
    );
    const layers = await listPublished({ limit: 100 });
    return {
        modules: Object.fromEntries(
            modules.map((module, index) => {
                const run = latest[index];
                return [
                    module,
                    run
                        ? {
                              id: run.id,
                              status: run.status,
                              finishedAt: run.finished_at,
                              metadata: run.result_metadata,
                              warnings: run.warnings,
                          }
                        : null,
                ];
            }),
        ),
        layers: layers.items,
    };
}

function getTrendConfig() {
    const d = defaults.TREND_FINAL_DEFAULTS;
    return {
        defaults: d,
        fields: [
            // ── Basic ────────────────────────────────────────────────────────────
            {
                key: 'analysisYear',
                category: 'basic',
                type: 'integer',
                label: 'Năm phân tích',
                description: 'Năm dương lịch cần phân tích xu thế ngập. Hệ thống sẽ tự động chia thành 4 mùa.',
                min: 2015,
                max: 2100,
                required: true,
            },
            {
                key: 'orbitPass',
                category: 'basic',
                type: 'select',
                label: 'Quỹ đạo vệ tinh',
                description: 'Chọn hướng bay của vệ tinh Sentinel-1. Tự động sẽ chọn hướng có nhiều ảnh nhất.',
                default: 'AUTO',
                options: [
                    { value: 'AUTO', label: 'Tự động' },
                    { value: 'ASCENDING', label: 'Quỹ đạo đi lên' },
                    { value: 'DESCENDING', label: 'Quỹ đạo đi xuống' },
                ],
            },
            // ── Advanced ─────────────────────────────────────────────────────────
            {
                key: 'handThresh',
                category: 'advanced',
                type: 'number',
                label: 'Ngưỡng địa hình thấp (HAND)',
                description: 'Loại trừ khu vực nằm cao hơn ngưỡng này so với hệ thống thoát nước gần nhất, giảm phát hiện nhầm trên đồi dốc.',
                unit: 'm',
                default: d.handThresh,
                min: 0,
                max: 100,
            },
            {
                key: 'slopeThresh',
                category: 'advanced',
                type: 'number',
                label: 'Độ dốc tối đa',
                description: 'Loại trừ khu vực có độ dốc lớn hơn ngưỡng này — đất dốc không có khả năng bị ngập thực sự.',
                unit: '°',
                default: d.slopeThresh,
                min: 0,
                max: 45,
            },
            {
                key: 'freqAlertMin',
                category: 'advanced',
                type: 'integer',
                label: 'Ngưỡng ngập tái diễn',
                description: 'Khu vực xuất hiện ngập từ bao nhiêu mùa trở lên được xem là ngập tái diễn (thường xuyên).',
                unit: 'mùa',
                default: d.freqAlertMin,
                min: 1,
                max: 4,
            },
            {
                key: 'floodRatioThresh',
                category: 'advanced',
                type: 'number',
                label: 'Ngưỡng phát hiện ngập dự phòng',
                description: 'Ngưỡng tỷ lệ tín hiệu SAR dùng khi thuật toán Otsu không xác định được ngưỡng tự động.',
                default: d.floodRatioThresh,
                min: 1.0,
                max: 5.0,
            },
            {
                key: 'ephemeralWaterMode',
                category: 'advanced',
                type: 'select',
                label: 'Xử lý vùng nước xuất hiện không thường xuyên',
                description: 'Quyết định cách xử lý các vùng nước tạm thời (ao mùa mưa, nước triều thấp).',
                default: d.ephemeralWaterMode,
                options: [
                    { value: 'flag', label: 'Đánh dấu (giữ nhưng phân biệt)' },
                    { value: 'exclude', label: 'Loại trừ khỏi kết quả' },
                ],
            },
            {
                key: 'useUrbanFloodLogic',
                category: 'advanced',
                type: 'boolean',
                label: 'Phát hiện ngập đô thị',
                description: 'Dùng tín hiệu phản xạ kép để phát hiện ngập trong khu vực đô thị — công nghê trả về ít bỏ sót hơn nhưng phức tạp hơn.',
                default: d.useUrbanFloodLogic,
            },
            {
                key: 'elevLowland',
                category: 'advanced',
                type: 'number',
                label: 'Ngưỡng độ cao vùng thấp',
                description: 'Khu vực có độ cao tuyệt đối thấp hơn ngưỡng này được xem là vùng trũng nhạy cảm tiêu thoát.',
                unit: 'm',
                default: d.elevLowland,
                min: 0,
                max: 50,
            },
            {
                key: 'lcYearOld',
                category: 'advanced',
                type: 'integer',
                label: 'Năm lớp đất cũ (so sánh thay đổi)',
                description: 'Năm lớp phủ đất dùng làm cơ sở để phát hiện thay đổi ao hồ → đô thị.',
                unit: 'năm',
                default: d.lcYearOld,
                min: 2017,
                max: 2100,
            },
            {
                key: 'lcYearNew',
                category: 'advanced',
                type: 'integer',
                label: 'Năm lớp đất mới (so sánh thay đổi)',
                description: 'Năm lớp phủ đất dùng để phát hiện thay đổi gần đây (phải lớn hơn năm lớp đất cũ).',
                unit: 'năm',
                default: d.lcYearNew,
                min: 2017,
                max: 2100,
            },
            // ── Expert ───────────────────────────────────────────────────────────
            {
                key: 'useOtsu',
                category: 'expert',
                type: 'boolean',
                label: 'Dùng thuật toán Otsu',
                description: 'Cho phép hệ thống tự xác định ngưỡng phát hiện ngập theo từng khu vực và mùa thay vì dùng ngưỡng cố định.',
                default: d.useOtsu,
            },
            {
                key: 'otsuRatioMin',
                category: 'expert',
                type: 'number',
                label: 'Otsu — tỷ lệ tối thiểu',
                description: 'Ngưỡng tối thiểu hợp lệ của kết quả Otsu. Nếu kết quả dưới ngưỡng này, dùng giá trị dự phòng.',
                default: d.otsuRatioMin,
                min: 1.0,
                max: 5.0,
            },
            {
                key: 'otsuRatioMax',
                category: 'expert',
                type: 'number',
                label: 'Otsu — tỷ lệ tối đa',
                description: 'Ngưỡng tối đa hợp lệ của kết quả Otsu.',
                default: d.otsuRatioMax,
                min: 1.0,
                max: 5.0,
            },
            {
                key: 'urbanDeltaUpDb',
                category: 'expert',
                type: 'number',
                label: 'Tín hiệu tăng tối thiểu tại đô thị',
                description: 'Độ tăng tín hiệu SAR (VH) tính bằng dB so với mùa khô để xác nhận ngập trong khu vực đô thị.',
                unit: 'dB',
                default: d.urbanDeltaUpDb,
                min: 0,
                max: 10,
            },
            {
                key: 'periodPadDays',
                category: 'expert',
                type: 'integer',
                label: 'Mở rộng cửa sổ thời gian',
                description: 'Số ngày thêm vào đầu và cuối mỗi mùa khi thu thập ảnh Sentinel-1, để tăng số lượng ảnh.',
                unit: 'ngày',
                default: d.periodPadDays,
                min: 0,
                max: 30,
            },
            // ── System (not exposed to UI) ────────────────────────────────────────
            { key: 'connMin', category: 'system', default: d.connMin },
            { key: 'connMax', category: 'system', default: d.connMax },
            { key: 'otsuScale', category: 'system', default: d.otsuScale },
            { key: 'otsuMaxBuckets', category: 'system', default: d.otsuMaxBuckets },
            { key: 'otsuLogMin', category: 'system', default: d.otsuLogMin },
            { key: 'otsuLogMax', category: 'system', default: d.otsuLogMax },
            { key: 'permWaterMonths', category: 'system', default: d.permWaterMonths },
            { key: 'polarization', category: 'system', default: d.polarization },
            { key: 'stratSource', category: 'system', default: d.stratSource },
            { key: 'useStratification', category: 'system', default: d.useStratification },
            { key: 'minePolygonAsset', category: 'system', default: d.minePolygonAsset },
            { key: 'mineFromBareGround', category: 'system', default: d.mineFromBareGround },
            { key: 'excludeMineStratumFromProduct', category: 'system', default: d.excludeMineStratumFromProduct },
            { key: 'useMineLikeSAR', category: 'system', default: d.useMineLikeSAR },
            { key: 'mineLikeDbMax', category: 'system', default: d.mineLikeDbMax },
            { key: 'mineLikeOccMax', category: 'system', default: d.mineLikeOccMax },
            { key: 'ephemeralOccMin', category: 'system', default: d.ephemeralOccMin },
            { key: 'ephemeralOccMax', category: 'system', default: d.ephemeralOccMax },
        ].filter((f) => f.category !== 'system'),
    };
}

function getConfig() {
    return {
        defaults: {
            event: defaults.S1_DEFAULTS,
            hand: defaults.HAND_DEFAULTS,
            impact: defaults.IMPACT_DEFAULTS,
            trend: defaults.TREND_FINAL_DEFAULTS,
            trendFinal: defaults.TREND_FINAL_DEFAULTS,
        },
        versions: versions.MODULE_TO_PIPELINE_VERSION,
        configVersion: versions.CONFIG_VERSION,
    };
}

async function attachLayerToScenario(scenario, actor) {
    if (!scenario) return null;
    if (scenario.layer_code) {
        const layer = await layerRepo.findByCode(scenario.layer_code);
        if (layer) {
            scenario.layer = webMapService.serializeLayer(layer, actor);
            scenario.layer.isEnableDefault = true;
        } else {
            scenario.layer = null;
        }
    }
    return scenario;
}

async function listScenarios(query = {}, actor = null) {
    const result = await floodScenarioRepo.listAll(query);
    result.items = await Promise.all(result.items.map((item) => attachLayerToScenario(item, actor)));
    return result;
}

async function getScenario(id, actor = null) {
    const scenario = await floodScenarioRepo.findById(id);
    if (!scenario) {
        throw new Api404Error('Không tìm thấy kịch bản ngập úng', ['SCENARIO_NOT_FOUND']);
    }
    return attachLayerToScenario(scenario, actor);
}

async function createScenario(data, actor = null) {
    const existing = await floodScenarioRepo.findByCode(data.code);
    if (existing) {
        throw new Api409Error(`Mã kịch bản '${data.code}' đã tồn tại`, ['DUPLICATE_SCENARIO_CODE']);
    }

    const layer = await layerRepo.findByCode(data.layerCode);
    if (!layer) {
        throw new Api404Error(`Không tìm thấy lớp bản đồ liên kết '${data.layerCode}'`, ['LAYER_NOT_FOUND']);
    }

    const created = await floodScenarioRepo.create(data);
    return attachLayerToScenario(created, actor);
}

async function updateScenario(id, data, actor = null) {
    const scenario = await floodScenarioRepo.findById(id);
    if (!scenario) {
        throw new Api404Error('Không tìm thấy kịch bản ngập úng', ['SCENARIO_NOT_FOUND']);
    }

    if (data.code && data.code !== scenario.code) {
        const existing = await floodScenarioRepo.findByCode(data.code);
        if (existing) {
            throw new Api409Error(`Mã kịch bản '${data.code}' đã tồn tại`, ['DUPLICATE_SCENARIO_CODE']);
        }
    }

    if (data.layerCode) {
        const layer = await layerRepo.findByCode(data.layerCode);
        if (!layer) {
            throw new Api404Error(`Không tìm thấy lớp bản đồ liên kết '${data.layerCode}'`, ['LAYER_NOT_FOUND']);
        }
    }

    const updated = await floodScenarioRepo.update(id, data);
    return attachLayerToScenario(updated, actor);
}

async function deleteScenario(id) {
    const scenario = await floodScenarioRepo.findById(id);
    if (!scenario) {
        throw new Api404Error('Không tìm thấy kịch bản ngập úng', ['SCENARIO_NOT_FOUND']);
    }
    return floodScenarioRepo.deleteScenario(id);
}

async function simulateFlood({ rainfall, tide }, actor) {
    const rainVal = Number(rainfall);
    const tideVal = tide !== null && tide !== undefined && tide !== '' ? Number(tide) : null;

    let matchedScenario = await floodScenarioRepo.findMatchingScenario(rainVal, tideVal);
    let targetLayerCode = matchedScenario?.layer_code;

    // Hardcoded fallback logic if no scenario DB match
    if (!targetLayerCode) {
        const SCENARIO_YEARS = [2015, 2018, 2020, 2022, 2024];
        let scenarioIndex = 0;
        if (rainVal >= 300) {
            scenarioIndex = 4;
        } else if (rainVal >= 200) {
            scenarioIndex = 3;
        } else if (rainVal >= 100) {
            scenarioIndex = 2;
        } else if (rainVal >= 50) {
            scenarioIndex = 1;
        } else {
            scenarioIndex = 0;
        }

        if (tideVal !== null && tideVal >= 2.0) {
            scenarioIndex = Math.min(SCENARIO_YEARS.length - 1, scenarioIndex + 1);
        }

        targetLayerCode = `lop_phu_sau_ngap_${SCENARIO_YEARS[scenarioIndex]}`;
    }

    const layer = await layerRepo.findByCode(targetLayerCode);
    if (!layer) {
        throw new Api404Error(`Không tìm thấy lớp dữ liệu cho kịch bản ${targetLayerCode}`, [
            'SCENARIO_LAYER_NOT_FOUND',
        ]);
    }

    const serialized = webMapService.serializeLayer(layer, actor);
    serialized.isEnableDefault = true;

    return {
        ...serialized,
        simulationParams: {
            rainfall: rainVal,
            tide: tideVal,
            scenarioId: matchedScenario?.id || null,
            scenarioCode: matchedScenario?.code || layer.code,
            scenarioName: matchedScenario?.name_vi || layer.name_vi,
            matchedLayerCode: layer.code,
        },
    };
}

module.exports = {
    analysisKey,
    submit,
    rerun,
    cancel,
    getRun,
    getRunDetail,
    listRuns,
    listPublished,
    listPublicRuns,
    publishArtifact,
    unpublishArtifact,
    overview,
    getConfig,
    getTrendConfig,
    simulateFlood,
    listScenarios,
    getScenario,
    createScenario,
    updateScenario,
    deleteScenario,
    getLegends: buildAllLegends,
    getAdminLegends: buildAllAdminLegends,
    updateLegend(artifactCode, patch) {
        if (!ARTIFACT_LAYER_DEFINITIONS[artifactCode]) {
            throw new Error(`Không tìm thấy artifact '${artifactCode}'`);
        }
        legendStore.upsertOverride(artifactCode, patch);
        const { buildAdminLegend } = require('./visualization/legends');
        return buildAdminLegend(artifactCode);
    },
    resetLegend(artifactCode) {
        legendStore.deleteOverride(artifactCode);
    },
    getQueueState: orchestrator.getQueueState,
};

