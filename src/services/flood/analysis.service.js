'use strict';

const crypto = require('crypto');
const runRepo = require('../../repositories/flood-analysis-run.repository');
const artifactRepo = require('../../repositories/flood-artifact.repository');
const ingestRepo = require('../../repositories/raster-ingest.repository');
const layerRepo = require('../../repositories/layer.repository');
const orchestrator = require('./orchestrator.service');
const geeAdapter = require('../gee-earth-engine.adapter');
const rasterIngest = require('../raster-ingest.service');
const minio = require('../minio.service');
const geoserver = require('../../utils/geoserver.client');
const { canManuallyPublish } = require('./config/product-vs-calibration');
const { validateRunConfig } = require('./config/schema');
const defaults = require('./config/defaults');
const versions = require('./config/versions');
const { buildAllLegends } = require('./visualization/legends');
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
    const modules = ['event', 'hand', 'rain', 'impact', 'trend'];
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
            rain: defaults.RAIN_RISK_DEFAULTS,
            impact: defaults.IMPACT_DEFAULTS,
            trend: defaults.TREND_DEFAULTS,
        },
        versions: versions.MODULE_TO_PIPELINE_VERSION,
        configVersion: versions.CONFIG_VERSION,
        probabilityCalibrated: false,
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
    getLegends: buildAllLegends,
    getQueueState: orchestrator.getQueueState,
};
