'use strict';

const queue = require('../../queues/gee-task.queue');
const childProcessWorker = require('../../workers/geeAnalysisProcess.worker');
const runRepo = require('../../repositories/flood-analysis-run.repository');

function enqueueRun(run) {
    const queueKey = `flood-analysis:${run.analysis_key}`;
    const promise = queue.enqueue({
        key: queueKey,
        label: `Flood ${run.module} run #${run.id}`,
        priority: run.mode === 'product' ? 10 : 0,
        cooldownMs: queue.MANUAL_TASK_COOLDOWN_MS,
        run: () =>
            childProcessWorker.run({
                kind: run.module,
                payload: { runId: run.id },
            }),
    });
    promise.catch(async (error) => {
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
    return queue.preflight({
        key: `flood-analysis:${analysisKey}`,
        cooldownMs: queue.MANUAL_TASK_COOLDOWN_MS,
    });
}

module.exports = { enqueueRun, preflightRun, getQueueState: queue.getState };
