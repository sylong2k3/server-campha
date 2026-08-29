'use strict';

const db = require('../configs/database');
const forestRepo = require('../repositories/forest-classification.repository');
const { OK } = require('../core/success.response');
const { hasPermission } = require('../middlewares/auth.middleware');

async function latestSucceededFloodRun() {
    const { rows } = await db.query(
        `SELECT id, module, status, params_snapshot, result_metadata, finished_at
           FROM gis.flood_analysis_runs
          WHERE status = 'SUCCEEDED' AND module = 'trend'
          ORDER BY finished_at DESC NULLS LAST, id DESC
          LIMIT 1`,
    );
    return rows[0] || null;
}

async function fieldReportStats() {
    const { rows } = await db.query(
        `SELECT status, COUNT(*)::int AS cnt
           FROM community.field_reports
          WHERE deleted_at IS NULL
          GROUP BY status`,
    );
    let total = 0;
    const byStatus = {};
    for (const row of rows) {
        byStatus[row.status] = row.cnt;
        total += row.cnt;
    }
    return { total, byStatus };
}

async function layerStats() {
    const { rows } = await db.query(
        `SELECT
            COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE publish_status = 'published')::int AS published,
            COUNT(*) FILTER (WHERE is_public = true)::int AS public_count,
            MAX(updated_at) AS latest_updated_at
         FROM gis.layers
         WHERE deleted_at IS NULL`,
    );
    const row = rows[0] || {};
    return {
        total: row.total || 0,
        published: row.published || 0,
        publicCount: row.public_count || 0,
        latestUpdatedAt: row.latest_updated_at || null,
    };
}

const overview = async (req, res) => {
    const permissions = req.user?.role_permissions;

    const canReadFlood = hasPermission(permissions, 'flood', 'read');
    const canReadForest = hasPermission(permissions, 'forest_classification', 'read');
    const canReadFeedback =
        hasPermission(permissions, 'field_report', 'read') ||
        hasPermission(permissions, 'field_report', 'stats');
    const canReadLayers = hasPermission(permissions, 'layers', 'read');

    const [floodRun, forestSnapshot, feedbackData, layerData] = await Promise.all([
        canReadFlood ? latestSucceededFloodRun() : Promise.resolve(null),
        canReadForest ? forestRepo.getLatestCompleted() : Promise.resolve(null),
        canReadFeedback ? fieldReportStats() : Promise.resolve(null),
        canReadLayers ? layerStats() : Promise.resolve(null),
    ]);

    // ── Flood ────────────────────────────────────────────────────────────────
    let flood = null;
    if (floodRun) {
        const areaStats = floodRun.result_metadata?.areaStats ?? {};
        const params = floodRun.params_snapshot ?? {};
        flood = {
            runId: floodRun.id,
            module: floodRun.module,
            status: floodRun.status,
            monitorStart: params.monitorStart ?? null,
            monitorEnd: params.monitorEnd ?? null,
            floodExtentAreaHa: areaStats.floodExtentAreaHa ?? null,
            populationAffected: areaStats.populationAffected ?? null,
            cropAffectedAreaHa: areaStats.cropAffectedAreaHa ?? null,
            builtAffectedAreaHa: areaStats.builtAffectedAreaHa ?? null,
            drainageAlertAreaHa: areaStats.drainageAlertAreaHa ?? null,
            finishedAt: floodRun.finished_at ?? null,
        };
    }

    // ── Forest classification + land composition ──────────────────────────────
    let classification = null;
    let landComposition = null;
    if (forestSnapshot) {
        const summary = forestSnapshot.province_summary ?? {};
        classification = {
            snapshotId: forestSnapshot.id,
            year: forestSnapshot.year,
            month: forestSnapshot.month,
            status: forestSnapshot.status,
            totalAreaHa: summary.totalHa ?? null,
            finishedAt: forestSnapshot.computed_at ?? forestSnapshot.published_at ?? null,
        };
        if (summary.totalHa != null) {
            landComposition = {
                forestAreaHa: summary.forestHa ?? null,
                mineAreaHa: summary.mineHa ?? null,
                forestPercent: summary.forestPercent ?? null,
                minePercent: summary.minePercent ?? null,
                totalAreaHa: summary.totalHa,
            };
        }
    }

    return OK(res, 'Đã tải tổng quan hệ thống', {
        flood,
        classification,
        landComposition,
        feedback: feedbackData,
        layers: layerData,
        generatedAt: new Date().toISOString(),
    });
};

module.exports = { overview };

