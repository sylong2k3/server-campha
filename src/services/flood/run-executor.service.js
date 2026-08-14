'use strict';

/**
 * Executes one persisted run inside the isolated GEE child process. Raw
 * ee.Image objects never cross IPC; only a small terminal summary is returned.
 */

const crypto = require('crypto');
const { ee } = require('../../configs/gge');
const geeAdapter = require('../gee-earth-engine.adapter');
const runRepo = require('../../repositories/flood-analysis-run.repository');
const artifactRepo = require('../../repositories/flood-artifact.repository');
const ingestRepo = require('../../repositories/raster-ingest.repository');
const rasterIngest = require('../raster-ingest.service');
const gcs = require('./gcs-artifact.service');
const geometry = require('./common/geometry');
const { ANALYSIS_CRS, ANALYSIS_SCALE_M, TREND_ANALYSIS_SCALE_M } = require('./common/projection');
const debug = require('./debug.util');

const INGEST_TERMINAL_FAILURES = new Set(['failed', 'url_expired', 'dlq']);

async function waitForIngestJob(jobId) {
    const timeoutMs = Math.max(
        60_000,
        Number(process.env.FLOOD_INGEST_WAIT_TIMEOUT_MS) || 25 * 60 * 1000,
    );
    const pollMs = Math.max(500, Number(process.env.FLOOD_INGEST_POLL_INTERVAL_MS) || 2_000);
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const job = await ingestRepo.findById(jobId);
        if (!job) {
            const error = new Error(`Raster ingest job ${jobId} disappeared`);
            error.code = 'RASTER_INGEST_JOB_NOT_FOUND';
            throw error;
        }
        if (job.status === 'completed') {
            return job;
        }
        if (INGEST_TERMINAL_FAILURES.has(job.status)) {
            const error = new Error(`Raster ingest job ${jobId} ended in ${job.status}`);
            error.code = `RASTER_INGEST_${job.status.toUpperCase()}`;
            throw error;
        }
        await new Promise((resolve) => setTimeout(resolve, pollMs));
    }
    const error = new Error(`Raster ingest job ${jobId} did not finish within ${timeoutMs}ms`);
    error.code = 'RASTER_INGEST_TIMEOUT';
    throw error;
}

const MODULE_RUNNERS = Object.freeze({
    event: { module: './event', fn: 'runSentinel1Flood' },
    hand: { module: './hand', fn: 'runHandScenario' },
    rain: { module: './rain', fn: 'runRainRisk' },
    trend: { module: './trend', fn: 'runTrendAnalysis' },
});

function safeMessage(error) {
    return String(error?.message || 'Flood analysis failed')
        .replace(/https?:\/\/\S+/gi, '[redacted-url]')
        .replace(/(private_key|client_secret|token)=?\S*/gi, '$1=[redacted]')
        .slice(0, 1000);
}

async function emit(run, stage, eventType, detail = null, elapsedMs = null) {
    await runRepo.createStageEvent({
        analysisRunId: run.id,
        stage,
        eventType,
        elapsedMs,
        attemptNo: run.attempt_no,
        detail,
    });
}

async function executeStage(run, stage, status, fn) {
    const started = Date.now();
    debug.log('run-executor.stage start', {
        runId: run.id,
        module: run.module,
        stage,
        status,
    });
    await runRepo.updateStatus(run.id, { status, stage });
    await emit(run, stage, 'stage_start');
    try {
        const value = await fn();
        const elapsed = Date.now() - started;
        debug.log('run-executor.stage end', {
            runId: run.id,
            stage,
            elapsed_ms: elapsed,
        });
        await emit(run, stage, 'stage_end', null, elapsed);
        return value;
    } catch (error) {
        const elapsed = Date.now() - started;
        debug.logError('run-executor.stage failed', error, {
            runId: run.id,
            stage,
            elapsed_ms: elapsed,
        });
        await emit(
            run,
            stage,
            'stage_error',
            { code: error.code || error.name },
            elapsed,
        );
        throw error;
    }
}

async function runScientificModule(run) {
    if (run.module === 'impact') {
        return runImpactWithReconstructedSource(run);
    }
    const descriptor = MODULE_RUNNERS[run.module];
    if (!descriptor) {
        throw new Error(`Unsupported flood module: ${run.module}`);
    }
    const service = require(descriptor.module);
    return service[descriptor.fn]({
        ee,
        geeAdapter,
        runConfig: run.params_snapshot,
        runMode: run.mode,
    });
}

async function runImpactWithReconstructedSource(run) {
    const impact = require('./impact');
    const sourceType = run.params_snapshot.impactSource || 'M1';
    const moduleBySource = { M1: 'event', M2: 'hand', M3: 'rain' };
    const sourceModule = moduleBySource[sourceType];
    const sourceRun = run.params_snapshot.sourceRunId
        ? await runRepo.findById(run.params_snapshot.sourceRunId)
        : await runRepo.findLatestByModule(sourceModule, { mode: run.mode });
    if (
        !sourceRun ||
        sourceRun.module !== sourceModule ||
        sourceRun.mode !== run.mode ||
        sourceRun.status !== 'SUCCEEDED'
    ) {
        const error = new Error(
            `No successful ${sourceType} source run is available for impact analysis`,
        );
        error.code = 'IMPACT_SOURCE_RUN_NOT_FOUND';
        throw error;
    }
    const descriptor = MODULE_RUNNERS[sourceModule];
    const sourceService = require(descriptor.module);
    const source = await sourceService[descriptor.fn]({
        ee,
        geeAdapter,
        runConfig: sourceRun.params_snapshot,
        runMode: 'product',
    });
    let sourceFloodMask;
    if (sourceType === 'M1') {
        sourceFloodMask = source.artifacts.main_flood_non_tidal;
    }
    if (sourceType === 'M2') {
        sourceFloodMask = source.artifacts.hand_scenario;
    }
    if (sourceType === 'M3') {
        sourceFloodMask = source.artifacts.rain_risk_score
            .gte(sourceRun.params_snapshot.threshold || 0.6)
            .selfMask();
    }
    return impact.runImpactAnalysis({
        ee,
        geeAdapter,
        runConfig: run.params_snapshot,
        runMode: run.mode,
        sourceFloodMask,
        sourceType,
        sourceRunId: sourceRun.id,
    });
}

function layerCode(run, artifactCode) {
    const raw = `fl_${run.module}_${artifactCode}_r${run.id}`
        .toLowerCase()
        .replace(/[^a-z0-9_]/g, '_');
    if (raw.length <= 58) {
        return raw;
    }
    const suffix = crypto.createHash('sha1').update(raw).digest('hex').slice(0, 8);
    return `${raw.slice(0, 49)}_${suffix}`;
}

async function ensureNotCancelled(runId) {
    const current = await runRepo.findById(runId);
    if (current?.status === 'CANCELLED') {
        const error = new Error('Flood run was cancelled');
        error.code = 'RUN_CANCELLED';
        throw error;
    }
}

async function exportAndHarvest(run, science, aoi) {
    const catalogByCode = new Map(science.catalog.map((entry) => [entry.code, entry]));
    const artifactRows = [];
    for (const [code, image] of Object.entries(science.artifacts || {})) {
        const definition = catalogByCode.get(code);
        if (!definition || !image) {
            continue;
        }
        const artifact = await artifactRepo.createForRun({
            analysisRunId: run.id,
            module: run.module,
            artifactCode: code,
            artifactRole: definition.role,
            pipelineVersion: run.pipeline_version,
            metadata: {
                label: definition.label,
                description: definition.description,
                style: definition.style,
            },
        });
        artifactRows.push({ artifact, definition, image });
    }

    const exportable = artifactRows.filter(
        ({ definition }) => run.mode === 'calibration' || definition.role === 'PRODUCT',
    );
    debug.log('run-executor.exportAndHarvest', {
        runId: run.id,
        artifactRows: artifactRows.length,
        exportable: exportable.length,
        exportableCodes: exportable.map(({ definition }) => definition.code),
    });
    const taskIds = {};
    const warnings = [...(science.metadata?.warnings || [])];
    for (const { artifact, definition, image } of exportable) {
        debug.log('run-executor.exportAndHarvest artifact', {
            runId: run.id,
            artifactId: artifact.id,
            code: definition.code,
            role: definition.role,
        });
        await ensureNotCancelled(run.id);
        const unique = `${Date.now()}_${artifact.id}`;
        const prefix = `flood/${run.module}/run_${run.id}/${definition.code}/${unique}`;
        const objectName = `${prefix}.tif`;
        const { bucket } = gcs.config();
        const task = await executeStage(run, `export:${definition.code}`, 'EXPORTING', () =>
            geeAdapter.submitExportToCloudStorage({
                image,
                description: `campha_${run.module}_${definition.code}_r${run.id}`.slice(0, 100),
                bucket,
                fileNamePrefix: prefix,
                region: aoi,
                scale: run.module === 'trend' ? TREND_ANALYSIS_SCALE_M : ANALYSIS_SCALE_M,
                crs: ANALYSIS_CRS,
                formatOptions: { cloudOptimized: true },
            }),
        );
        taskIds[definition.code] = task.taskName;
        await runRepo.updateStatus(run.id, { geeTaskIds: taskIds });
        const terminal = await executeStage(
            run,
            `wait_export:${definition.code}`,
            'HARVESTING',
            () => geeAdapter.pollExportTask(task.taskName),
        );
        if (terminal.state !== 'COMPLETED') {
            const error = new Error(`GEE export ${definition.code} ended in ${terminal.state}`);
            error.code = `GEE_EXPORT_${terminal.state}`;
            debug.logError('run-executor.exportAndHarvest gee-export non-terminal', error, {
                runId: run.id,
                code: definition.code,
                terminalState: terminal.state,
            });
            throw error;
        }
        debug.log('run-executor.exportAndHarvest gee-export completed', {
            runId: run.id,
            code: definition.code,
            objectName,
        });
        await gcs.waitForObject(objectName);
        const signed = await gcs.signedDownloadUrl(objectName);
        debug.log('run-executor.exportAndHarvest gcs signed', {
            runId: run.id,
            code: definition.code,
            gcsBucket: signed.bucket,
        });
        const publish = run.mode === 'product' && definition.role === 'PRODUCT';
        const enqueued = await executeStage(run, `archive:${definition.code}`, 'ARCHIVING', () =>
            rasterIngest.enqueue({
                sourceUrl: signed.url,
                sourceKind: 'gcs_export',
                layerCode: layerCode(run, definition.code),
                nameVi: definition.label?.vi || definition.code,
                nameEn: definition.label?.en || definition.code,
                isPublic: publish,
                category: 'flood',
                user: { id: run.started_by },
                requestParams: {
                    publish,
                    bucketCategory:
                        run.mode === 'calibration' ? 'flood-calibration' : 'flood-rasters',
                    styleName: definition.style || null,
                    epsg_code: 32648,
                    scale_m: run.module === 'trend' ? 10 : 30,
                    gee_task_id: task.taskId,
                    linkedResource: { type: 'flood_artifact', id: artifact.id },
                },
            }),
        );
        debug.log('run-executor.exportAndHarvest ingest enqueued', {
            runId: run.id,
            code: definition.code,
            ingestJobId: enqueued.job.id,
            publish,
            bucketCategory:
                run.mode === 'calibration' ? 'flood-calibration' : 'flood-rasters',
        });
        await artifactRepo.updateAssetMetadata(artifact.id, {
            gcsBucket: signed.bucket,
            gcsObject: objectName,
            ingestJobId: enqueued.job.id,
            metadata: { geeTaskId: task.taskId, archiveOnly: !publish },
        });
        await executeStage(
            run,
            `${publish ? 'publish' : 'validate_archive'}:${definition.code}`,
            publish ? 'PUBLISHING' : 'VALIDATING',
            () => waitForIngestJob(enqueued.job.id),
        );
        try {
            await gcs.deleteObject(objectName);
            debug.log('run-executor.exportAndHarvest gcs cleaned', {
                runId: run.id,
                code: definition.code,
            });
        } catch (error) {
            warnings.push(`GCS_CLEANUP_FAILED:${definition.code}`);
            debug.logError('run-executor.exportAndHarvest gcs cleanup failed', error, {
                runId: run.id,
                code: definition.code,
            });
            await emit(run, `cleanup:${definition.code}`, 'stage_warn', {
                code: error.code || error.name,
            });
        }
    }
    debug.log('run-executor.exportAndHarvest done', {
        runId: run.id,
        artifactCount: artifactRows.length,
        exportedCount: exportable.length,
        warnings,
    });
    return { artifactCount: artifactRows.length, exportedCount: exportable.length, warnings };
}

async function executePersistedRun({ runId } = {}) {
    debug.log('run-executor.executePersistedRun start', { runId });
    const run = await runRepo.findById(runId);
    if (!run) {
        debug.logError('run-executor.executePersistedRun', new Error('run not found'), { runId });
        throw new Error(`Flood run ${runId} not found`);
    }
    if (run.status === 'CANCELLED') {
        debug.log('run-executor.executePersistedRun skipped: CANCELLED', { runId });
        return { runId, status: 'CANCELLED', artifactCount: 0 };
    }
    debug.log('run-executor.executePersistedRun loaded', {
        runId: run.id,
        module: run.module,
        mode: run.mode,
        attemptNo: run.attempt_no,
    });
    await geeAdapter.ensureInitialized();
    debug.log('run-executor.gee.ensureInitialized ok', { runId });
    await runRepo.startRun(run.id);
    try {
        const science = await executeStage(run, 'compute', 'COMPUTING', () =>
            runScientificModule(run),
        );
        debug.log('run-executor.science ok', {
            runId,
            artifactCount: Object.keys(science.artifacts || {}).length,
            warnings: science.metadata?.warnings || [],
        });
        const { geometry: aoi } = geometry.loadAoi(ee);
        const harvested = await exportAndHarvest(run, science, aoi);
        await runRepo.finishRun(run.id, {
            status: 'SUCCEEDED',
            warnings: harvested.warnings,
            resultMetadata: science.metadata || {},
        });
        await emit(run, 'complete', 'stage_end', {
            artifactCount: harvested.artifactCount,
            exportedCount: harvested.exportedCount,
        });
        debug.log('run-executor.executePersistedRun SUCCEEDED', {
            runId: run.id,
            artifactCount: harvested.artifactCount,
            exportedCount: harvested.exportedCount,
            warnings: harvested.warnings,
        });
        return { runId: run.id, status: 'SUCCEEDED', ...harvested };
    } catch (error) {
        debug.logError('run-executor.executePersistedRun failed', error, { runId: run.id });
        const current = await runRepo.findById(run.id);
        if (current?.status !== 'CANCELLED') {
            await runRepo.finishRun(run.id, {
                status: error.code === 'RUN_CANCELLED' ? 'CANCELLED' : 'FAILED',
                errorCode: error.code || error.name || 'FLOOD_RUN_FAILED',
                errorMessageSafe: safeMessage(error),
            });
        }
        throw error;
    }
}

module.exports = {
    executePersistedRun,
    runScientificModule,
    layerCode,
    safeMessage,
};
