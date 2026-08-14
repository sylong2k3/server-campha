'use strict';

const geeQueue = require('../queues/gee-task.queue');

const PIPELINE_LABELS = Object.freeze({
    'forest-classification': 'Phân loại lớp phủ rừng',
    flood: 'Mô phỏng ngập lụt',
});

const nonNegativeInteger = (value) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? Math.trunc(parsed) : 0;
};

const pipelineFromKey = (key) => {
    const value = String(key || '');
    if (value.startsWith('analysis:forest-classification:')) {
        return 'forest-classification';
    }
    if (value.startsWith('analysis:flood:')) {
        return 'flood';
    }
    return null;
};

const normalizeDistrictExport = (summary) => {
    if (!summary || typeof summary !== 'object' || Array.isArray(summary)) {
        return {
            status: 'not_started',
            total: 0,
            completed: 0,
            failed: 0,
            skipped: 0,
            pending: 0,
            progressPercent: 0,
        };
    }

    const total = nonNegativeInteger(summary.total);
    const completed = nonNegativeInteger(summary.completed);
    const failed = nonNegativeInteger(summary.failed);
    const skipped = nonNegativeInteger(summary.skipped);
    const settled = Math.min(total, completed + failed + skipped);
    const pending =
        summary.pending === null || summary.pending === undefined
            ? Math.max(0, total - settled)
            : Math.min(total, nonNegativeInteger(summary.pending));
    const status =
        total === 0
            ? 'not_started'
            : pending > 0
              ? settled > 0
                  ? 'running'
                  : 'queued'
              : failed > 0
                ? 'completed_with_errors'
                : 'completed';

    return {
        status,
        total,
        completed,
        failed,
        skipped,
        pending,
        progressPercent: total > 0 ? Math.round((settled / total) * 100) : 0,
    };
};

/**
 * Build the complete processing contract consumed by the admin UI. Queue
 * entries are in-memory, while retry and district-export state are persisted
 * on the snapshot, so both parts are combined here at the API boundary.
 */
const buildGeeProcessingState = ({ pipeline, taskKey = null, snapshot = null } = {}) => {
    const queue = geeQueue.getState();
    const prefix = `analysis:${pipeline}:`;
    const isTarget = (entry) =>
        Boolean(entry) &&
        (taskKey ? entry.key === taskKey : String(entry.key || '').startsWith(prefix));
    const activeIsTarget = isTarget(queue.active);
    const pendingIndex = queue.pending.findIndex(isTarget);
    const targetPending = pendingIndex >= 0 ? queue.pending[pendingIndex] : null;
    const jobsAhead = targetPending ? pendingIndex + (queue.active ? 1 : 0) : 0;
    const activePipeline = pipelineFromKey(queue.active?.key);
    const snapshotStatus = String(snapshot?.status || '').toLowerCase() || 'idle';
    const districtExport = normalizeDistrictExport(
        snapshot?.district_export_summary || snapshot?.districtExportSummary,
    );

    let state = snapshotStatus;
    if (targetPending) {
        state = 'queued';
    } else if (activeIsTarget) {
        state = 'computing';
    } else if (
        ['completed', 'published'].includes(snapshotStatus) &&
        ['queued', 'running'].includes(districtExport.status)
    ) {
        state = 'exporting';
    }

    return {
        pipeline,
        state,
        queue: {
            status: activeIsTarget ? 'running' : targetPending ? 'queued' : 'idle',
            concurrency: queue.concurrency,
            maxPending: queue.maxPending,
            capacityRemaining: queue.capacityRemaining,
            accepting: queue.accepting,
            position: targetPending ? jobsAhead + 1 : activeIsTarget ? 0 : null,
            jobsAhead,
            waitingCount: queue.pending.length,
            enqueuedAt: targetPending?.enqueuedAt || (activeIsTarget ? queue.active?.enqueuedAt : null),
            startedAt: activeIsTarget ? queue.active?.startedAt || null : null,
            globalBusy: Boolean(queue.active),
            activePipeline,
            activePipelineLabel: activePipeline ? PIPELINE_LABELS[activePipeline] || activePipeline : null,
        },
        districtExport,
        retry: {
            count: nonNegativeInteger(snapshot?.retry_count ?? snapshot?.retryCount),
            nextRetryAt: snapshot?.next_retry_at || snapshot?.nextRetryAt || null,
            lastError:
                snapshot?.last_retry_error ||
                snapshot?.lastRetryError ||
                snapshot?.error_message ||
                snapshot?.errorMessage ||
                null,
        },
    };
};

module.exports = { buildGeeProcessingState, normalizeDistrictExport };
