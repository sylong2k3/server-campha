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
    let normalized;
    try {
        normalized = validateRunConfig(module, { ...config, mode });
    } catch (error) {
        debug.logError('analysis.submit validation failed', error, { module });
        throw new Api400Error(error.message, ['INVALID_FLOOD_CONFIG']);
    }
    const key = analysisKey(module, normalized);
    debug.log('analysis.submit config validated', { module, analysisKey: key });
    await ensureRunAdmissible(key);
    const run = await createRun({
        analysisKey: key,
        attemptNo: await runRepo.nextAttemptNo(key),
        module,
        mode: normalized.mode,
        pipelineVersion: versions.pipelineVersionFor(module),
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

function getConfig() {
    return {
        defaults: {
            event: defaults.S1_DEFAULTS,
            hand: defaults.HAND_DEFAULTS,
            impact: defaults.IMPACT_DEFAULTS,
            trend: defaults.TREND_DEFAULTS,
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

