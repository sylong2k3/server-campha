'use strict';

const queue = require('../../queues/gee-task.queue');
const childProcessWorker = require('../../workers/geeAnalysisProcess.worker');
const runRepo = require('../../repositories/flood-analysis-run.repository');
const debug = require('./debug.util');

function enqueueRun(run) {
    const queueKey = `flood-analysis:${run.analysis_key}`;
    debug.log('orchestrator.enqueueRun', {
        runId: run.id,
        module: run.module,
        mode: run.mode,
        queueKey,
        priority: run.mode === 'product' ? 10 : 0,
    });
    const promise = queue.enqueue({
        key: queueKey,
        label: `Flood ${run.module} run #${run.id}`,
        priority: run.mode === 'product' ? 10 : 0,
        cooldownMs: queue.MANUAL_TASK_COOLDOWN_MS,
        run: () => {
            debug.log('orchestrator.queue.run start', {
                runId: run.id,
                module: run.module,
            });
            return childProcessWorker
                .run({ kind: run.module, payload: { runId: run.id } })
                .then((result) => {
                    debug.log('orchestrator.queue.run child returned', {
                        runId: run.id,
                        result: result?.status ? { status: result.status } : 'ok',
                    });
                    return result;
                });
        },
    });
    promise.catch(async (error) => {
        debug.logError('orchestrator.enqueueRun rejected', error, { runId: run.id });
        try {
            const current = await runRepo.findById(run.id);
            if (current && !runRepo.TERMINAL_STATUSES.includes(current.status)) {
                await runRepo.finishRun(run.id, {
                    status: 'FAILED',
                    errorCode: error.code || error.name || 'GEE_CHILD_FAILED',
                    errorMessageSafe: String(error.message || 'GEE child failed')
                        .replace(/https?:\/\/\S+/gi, '[redacted-url]')
                        .slice(0, 1000),
                });
            }
        } catch (persistError) {
            console.error(
                `[FLOOD] could not persist failed run #${run.id}: ${persistError.message}`,
            );
        }
    });
    return promise;
}

function preflightRun(analysisKey) {
    debug.log('orchestrator.preflightRun', { analysisKey });
    return queue.preflight({
        key: `flood-analysis:${analysisKey}`,
        cooldownMs: queue.MANUAL_TASK_COOLDOWN_MS,
    });
}

module.exports = { enqueueRun, preflightRun, getQueueState: queue.getState };
