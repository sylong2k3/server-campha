'use strict';

/**
 * Data-access layer for `gis.flood_analysis_runs`, `gis.flood_run_stage_events`,
 * and `gis.flood_run_audit`.
 *
 * Consumed by:
 *   - services/flood/analysis.service.js       (create, findById, list, updateStatus, finishRun, startRun, nextAttemptNo)
 *   - services/flood/orchestrator.service.js   (updateStatus, createStageEvent, finishRun)
 *   - workers/geeInterruptedRunRecovery.worker (failInterruptedActiveRuns)
 *   - admin actions                            (insertAudit)
 *
 * @schema migrations/080_flood_domain.sql
 */

const db = require('../configs/database');

const LIVE_STATUSES = Object.freeze([
    'QUEUED',
    'COMPUTING',
    'EXPORTING',
    'HARVESTING',
    'VALIDATING',
    'ARCHIVING',
    'PUBLISHING',
]);

const TERMINAL_STATUSES = Object.freeze(['SUCCEEDED', 'FAILED', 'CANCELLED', 'DLQ']);

// ── Reads ────────────────────────────────────────────────────────────────────

const findById = async (id, client = db) => {
    const { rows } = await client.query('SELECT * FROM gis.flood_analysis_runs WHERE id = $1', [
        id,
    ]);
    return rows[0] || null;
};

const findLatestByModule = async (module, { onlySucceeded = true, mode } = {}, client = db) => {
    const params = [module];
    const where = ['module = $1'];
    if (onlySucceeded) {
        where.push("status = 'SUCCEEDED'");
    }
    if (mode) {
        params.push(mode);
        where.push(`mode = $${params.length}`);
    }
    const { rows } = await client.query(
        `SELECT *
           FROM gis.flood_analysis_runs
          WHERE ${where.join(' AND ')}
          ORDER BY finished_at DESC NULLS LAST, id DESC
          LIMIT 1`,
        params,
    );
    return rows[0] || null;
};

const findActiveByAnalysisKey = async (analysisKey, client = db) => {
    const { rows } = await client.query(
        `SELECT * FROM gis.flood_analysis_runs
          WHERE analysis_key = $1 AND status = ANY($2::text[])
          ORDER BY id DESC LIMIT 1`,
        [analysisKey, LIVE_STATUSES],
    );
    return rows[0] || null;
};

const list = async ({ module, mode, status, from, to, startedBy, limit = 20, offset = 0 } = {}) => {
    const where = [];
    const params = [];
    if (module) {
        params.push(module);
        where.push(`module = $${params.length}`);
    }
    if (mode) {
        params.push(mode);
        where.push(`mode = $${params.length}`);
    }
    if (status) {
        params.push(status);
        where.push(`status = $${params.length}`);
    }
    if (from) {
        params.push(from);
        where.push(`created_at >= $${params.length}`);
    }
    if (to) {
        params.push(to);
        where.push(`created_at < $${params.length}`);
    }
    if (startedBy) {
        params.push(startedBy);
        where.push(`started_by = $${params.length}`);
    }
    params.push(Math.max(1, Math.min(100, limit)));
    params.push(Math.max(0, offset));
    const { rows } = await db.query(
        `SELECT *, COUNT(*) OVER()::int AS total_count
           FROM gis.flood_analysis_runs
          ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
          ORDER BY created_at DESC, id DESC
          LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params,
    );
    const total = rows[0]?.total_count || 0;
    return { items: rows.map(({ total_count: _t, ...row }) => row), total };
};

/**
 * Compute the next attempt_no for a given analysis_key. Used by admin's rerun
 * action — a new attempt row shares the analysis_key but increments attempt_no
 * so history remains intact (§47).
 */
const nextAttemptNo = async (analysisKey, client = db) => {
    const { rows } = await client.query(
        `SELECT COALESCE(MAX(attempt_no), 0) + 1 AS next
           FROM gis.flood_analysis_runs
          WHERE analysis_key = $1`,
        [analysisKey],
    );
    return rows[0]?.next || 1;
};

// ── Writes ───────────────────────────────────────────────────────────────────

const create = async (payload, client = db) => {
    const {
        analysisKey,
        attemptNo = 1,
        module,
        mode,
        status = 'QUEUED',
        pipelineVersion,
        configVersion,
        paramsSnapshot,
        aoiSource,
        startedBy = null,
    } = payload;
    const { rows } = await client.query(
        `INSERT INTO gis.flood_analysis_runs (
            analysis_key, attempt_no, module, mode, status,
            pipeline_version, config_version, params_snapshot, aoi_source, started_by
         ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10
         )
         RETURNING *`,
        [
            analysisKey,
            attemptNo,
            module,
            mode,
            status,
            pipelineVersion,
            configVersion,
            JSON.stringify(paramsSnapshot || {}),
            aoiSource,
            startedBy,
        ],
    );
    return rows[0];
};

const startRun = async (id, client = db) => {
    const { rows } = await client.query(
        `UPDATE gis.flood_analysis_runs
            SET status = 'COMPUTING', started_at = COALESCE(started_at, NOW())
          WHERE id = $1
          RETURNING *`,
        [id],
    );
    return rows[0] || null;
};

const updateStatus = async (
    id,
    { status, stage, geeTaskIds, warnings, resultMetadata, errorCode, errorMessageSafe } = {},
    client = db,
) => {
    const patches = [];
    const params = [id];
    if (status !== undefined) {
        params.push(status);
        patches.push(`status = $${params.length}`);
    }
    if (stage !== undefined) {
        params.push(stage);
        patches.push(`stage = $${params.length}`);
    }
    if (geeTaskIds !== undefined) {
        params.push(JSON.stringify(geeTaskIds));
        patches.push(`gee_task_ids = $${params.length}::jsonb`);
    }
    if (warnings !== undefined) {
        params.push(JSON.stringify(warnings));
        patches.push(`warnings = $${params.length}::jsonb`);
    }
    if (resultMetadata !== undefined) {
        params.push(JSON.stringify(resultMetadata));
        patches.push(`result_metadata = $${params.length}::jsonb`);
    }
    if (errorCode !== undefined) {
        params.push(errorCode);
        patches.push(`error_code = $${params.length}`);
    }
    if (errorMessageSafe !== undefined) {
        params.push(errorMessageSafe);
        patches.push(`error_message_safe = $${params.length}`);
    }
    if (patches.length === 0) {
        return null;
    }
    const { rows } = await client.query(
        `UPDATE gis.flood_analysis_runs
            SET ${patches.join(', ')}
          WHERE id = $1
          RETURNING *`,
        params,
    );
    return rows[0] || null;
};

const finishRun = async (
    id,
    { status = 'SUCCEEDED', warnings, resultMetadata, errorCode, errorMessageSafe } = {},
    client = db,
) => {
    const params = [id, status];
    const setClauses = ['status = $2', 'finished_at = NOW()'];
    if (warnings !== undefined) {
        params.push(JSON.stringify(warnings));
        setClauses.push(`warnings = $${params.length}::jsonb`);
    }
    if (resultMetadata !== undefined) {
        params.push(JSON.stringify(resultMetadata));
        setClauses.push(`result_metadata = $${params.length}::jsonb`);
    }
    if (errorCode !== undefined) {
        params.push(errorCode);
        setClauses.push(`error_code = $${params.length}`);
    }
    if (errorMessageSafe !== undefined) {
        params.push(errorMessageSafe);
        setClauses.push(`error_message_safe = $${params.length}`);
    }
    const { rows } = await client.query(
        `UPDATE gis.flood_analysis_runs
            SET ${setClauses.join(', ')}
          WHERE id = $1
          RETURNING *`,
        params,
    );
    return rows[0] || null;
};

/**
 * Recovery entry point (§76). Move all runs in a live status to FAILED with a
 * distinct error_code so audit can tell "actual failure" from "server restart".
 * The caller may re-submit a new attempt via the admin rerun flow.
 */
const failInterruptedActiveRuns = async ({ errorCode = 'INTERRUPTED_ON_RESTART' } = {}) => {
    const { rows } = await db.query(
        `UPDATE gis.flood_analysis_runs
            SET status = 'FAILED',
                finished_at = COALESCE(finished_at, NOW()),
                error_code = COALESCE(error_code, $1),
                error_message_safe = COALESCE(
                    error_message_safe,
                    'Run interrupted by server restart'
                )
          WHERE status = ANY($2::text[])
          RETURNING id, module, analysis_key, attempt_no, params_snapshot`,
        [errorCode, LIVE_STATUSES],
    );
    return rows;
};

/**
 * Hard-delete a single terminal run (§admin "xóa lượt phân tích đã chạy").
 * Only rows already in a TERMINAL_STATUSES state may be deleted — live runs
 * must be cancelled first. flood_artifacts and flood_run_stage_events cascade
 * via ON DELETE CASCADE (§080_flood_domain.sql); flood_run_audit rows are
 * detached via ON DELETE SET NULL (§112_flood_run_delete.sql) so the audit
 * trail survives the run's deletion.
 */
const deleteRun = async (id, client = db) => {
    const { rows } = await client.query(
        `DELETE FROM gis.flood_analysis_runs
          WHERE id = $1 AND status = ANY($2::text[])
          RETURNING id`,
        [id, TERMINAL_STATUSES],
    );
    return rows[0] || null;
};

// ── Stage event log (§74 observability) ──────────────────────────────────────

const createStageEvent = async (
    { analysisRunId, stage, eventType, elapsedMs = null, attemptNo = 1, detail = null } = {},
    client = db,
) => {
    const { rows } = await client.query(
        `INSERT INTO gis.flood_run_stage_events (
            analysis_run_id, stage, event_type, elapsed_ms, attempt_no, detail
         ) VALUES ($1, $2, $3, $4, $5, $6::jsonb)
         RETURNING *`,
        [
            analysisRunId,
            stage,
            eventType,
            elapsedMs,
            attemptNo,
            detail ? JSON.stringify(detail) : null,
        ],
    );
    return rows[0];
};

const listStageEvents = async (analysisRunId, { limit = 200 } = {}, client = db) => {
    const { rows } = await client.query(
        `SELECT * FROM gis.flood_run_stage_events
          WHERE analysis_run_id = $1
          ORDER BY emitted_at, id
          LIMIT $2`,
        [analysisRunId, Math.max(1, Math.min(500, limit))],
    );
    return rows;
};

// ── Manual-action audit trail ────────────────────────────────────────────────

const AUDIT_ACTIONS = Object.freeze([
    'submit',
    'rerun',
    'cancel',
    'publish',
    'unpublish',
    'retry_publish',
    'discard_artifact',
    'delete_run',
]);

const insertAudit = async (
    { analysisRunId, artifactId, actorUserId, action, metadata, ip, userAgent } = {},
    client = db,
) => {
    if (!AUDIT_ACTIONS.includes(action)) {
        throw new Error(`Unsupported audit action: ${action}`);
    }
    const { rows } = await client.query(
        `INSERT INTO gis.flood_run_audit (
            analysis_run_id, artifact_id, actor_user_id, action, metadata, ip, user_agent
         ) VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)
         RETURNING *`,
        [
            analysisRunId || null,
            artifactId || null,
            actorUserId || null,
            action,
            JSON.stringify(metadata || {}),
            ip || null,
            userAgent || null,
        ],
    );
    return rows[0];
};

module.exports = {
    LIVE_STATUSES,
    TERMINAL_STATUSES,
    AUDIT_ACTIONS,
    findById,
    findLatestByModule,
    findActiveByAnalysisKey,
    list,
    nextAttemptNo,
    create,
    startRun,
    updateStatus,
    finishRun,
    deleteRun,
    failInterruptedActiveRuns,
    createStageEvent,
    listStageEvents,
    insertAudit,
};
