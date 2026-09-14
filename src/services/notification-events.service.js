'use strict';

const notificationService = require('./notification.service');
const systemLogger = require('../utils/systemLogger.util');

const MANAGER_ROLES = Object.freeze(['system_admin', 'ubnd_tp', 'so_tnmt', 'so_xd']);

const safeDispatch = async (eventKey, message) => {
    try {
        const result = await notificationService.broadcastToRoles(MANAGER_ROLES, {
            ...message,
            eventKey,
        });
        systemLogger.logInfo('notification_events', `Đã phát thông báo: ${message.type}`, {
            eventKey,
            recipientCount: result?.recipientCount || 0,
            duplicate: result?.duplicate || false,
        });
        return result;
    } catch (error) {
        systemLogger.logError('notification_events', `Lỗi phát thông báo: ${message.type}`, {
            eventKey,
            error: error?.message,
        });
        return null;
    }
};

const notifyForestSnapshotCompleted = async (snapshot, { seasonContext, coverage } = {}) => {
    const label = seasonContext?.label || `Kỳ ${snapshot.year}-${String(snapshot.month).padStart(2, '0')}`;
    const forestHa = coverage?.forestHa != null ? Number(coverage.forestHa).toFixed(1) : 'N/A';
    const forestPercent = coverage?.forestPercent != null ? Number(coverage.forestPercent).toFixed(2) : 'N/A';
    const mineHa = coverage?.mineHa != null ? Number(coverage.mineHa).toFixed(1) : 'N/A';
    const minePercent = coverage?.minePercent != null ? Number(coverage.minePercent).toFixed(2) : 'N/A';

    const eventKey = `forest:${snapshot.year}-${String(snapshot.month).padStart(2, '0')}:completed`;
    const message = {
        type: 'forest_snapshot_completed',
        title: `Phân loại rừng: ${label}`,
        body: `Phân loại rừng ${label} hoàn tất. Tỉ lệ che phủ rừng: ${forestPercent}% (${forestHa} ha), bãi than: ${minePercent}% (${mineHa} ha).`,
        data: {
            channel: 'forest',
            year: snapshot.year,
            month: snapshot.month,
            snapshotId: snapshot.id,
            forestPercent: coverage?.forestPercent,
            forestHa: coverage?.forestHa,
            minePercent: coverage?.minePercent,
            mineHa: coverage?.mineHa,
            label,
        },
    };
    return safeDispatch(eventKey, message);
};

const notifyForestSnapshotFailed = async (snapshot, { seasonContext, error } = {}) => {
    const label = seasonContext?.label || `Kỳ ${snapshot.year}-${String(snapshot.month).padStart(2, '0')}`;
    const attempt = snapshot.attempt || 1;
    const eventKey = `forest:${snapshot.year}-${String(snapshot.month).padStart(2, '0')}:failed:${attempt}`;
    const message = {
        type: 'forest_snapshot_failed',
        title: `Phân loại rừng: ${label} thất bại`,
        body: `Xử lý phân loại rừng ${label} thất bại (lần thử ${attempt}): ${error?.message || 'Lỗi không xác định'}`,
        data: {
            channel: 'forest',
            year: snapshot.year,
            month: snapshot.month,
            snapshotId: snapshot.id,
            attempt,
            error: error?.message,
            label,
        },
    };
    return safeDispatch(eventKey, message);
};

const notifyFloodRunCompleted = async (run, { floodAreaHa, floodPercentage, warnings } = {}) => {
    const mod = String(run.module || 'event').toUpperCase();
    const areaStr = floodAreaHa != null ? `${Number(floodAreaHa).toFixed(1)} ha` : 'N/A';
    const pctStr = floodPercentage != null ? ` (tỉ lệ ${Number(floodPercentage).toFixed(2)}%)` : '';
    const eventKey = `flood_run:${run.id}:succeeded`;
    const message = {
        type: 'flood_run_succeeded',
        title: `Cảnh báo ngập lụt: Phân tích hoàn tất (${mod})`,
        body: `Phân tích ngập lụt #${run.id} (${run.module}) thành công. Diện tích ngập: ${areaStr}${pctStr}. Đã cập nhật bản đồ.`,
        data: {
            channel: 'flood',
            runId: run.id,
            module: run.module,
            floodAreaHa,
            floodPercentage,
            warnings: warnings || [],
        },
    };
    return safeDispatch(eventKey, message);
};

const notifyFloodRunFailed = async (run, error) => {
    const mod = String(run.module || 'event').toUpperCase();
    const attempt = run.attempt_no || 1;
    const eventKey = `flood_run:${run.id}:failed:${attempt}`;
    const message = {
        type: 'flood_run_failed',
        title: `Cảnh báo ngập lụt: Phân tích #${run.id} thất bại`,
        body: `Phân tích ngập lụt #${run.id} (${mod}) thất bại: ${error?.message || 'Lỗi xử lý'}`,
        data: {
            channel: 'flood',
            runId: run.id,
            module: run.module,
            attemptNo: attempt,
            error: error?.message,
        },
    };
    return safeDispatch(eventKey, message);
};

const notifyHydroScenarioTriggered = async ({ scenario, layerCode, rainVal, tideVal } = {}) => {
    const scenarioName = scenario?.name_vi || layerCode || 'Kịch bản thủy văn';
    const minRain = scenario?.min_rainfall ?? 0;
    const tideStr = tideVal != null ? `, triều ${tideVal} m` : '';
    const hourBucket = new Date().toISOString().slice(0, 13);
    const identifier = scenario?.id || scenario?.code || layerCode || 'unknown';
    const eventKey = `hydro_scenario:${identifier}:${Math.round(rainVal)}:${hourBucket}`;

    const message = {
        type: 'hydro_scenario_triggered',
        title: `Cảnh báo kịch bản thủy văn: ${scenarioName}`,
        body: `Mô phỏng lượng mưa ${rainVal} mm${tideStr} kích hoạt kịch bản '${scenarioName}' (ngưỡng tối thiểu ${minRain} mm). Lớp dữ liệu: ${scenario?.layer_code || layerCode}.`,
        data: {
            channel: 'flood',
            scenarioId: scenario?.id || null,
            scenarioCode: scenario?.code || null,
            layerCode: scenario?.layer_code || layerCode,
            rainfall: rainVal,
            tide: tideVal,
        },
    };
    return safeDispatch(eventKey, message);
};

const notifyHydroScenarioUpdated = async (scenario) => {
    if (!scenario?.id) {
        return null;
    }
    const name = scenario.name_vi || scenario.code;
    const eventKey = `hydro_scenario:${scenario.id}:updated:${Date.now()}`;
    const rangeStr = scenario.max_rainfall != null
        ? `${scenario.min_rainfall} - ${scenario.max_rainfall} mm`
        : `≥ ${scenario.min_rainfall} mm`;

    const message = {
        type: 'hydro_scenario_updated',
        title: `Cập nhật kịch bản thủy văn: ${name}`,
        body: `Kịch bản ${name} (${scenario.code}) đã cập nhật thông số ngưỡng (Mưa: ${rangeStr}).`,
        data: {
            channel: 'flood',
            scenarioId: scenario.id,
            code: scenario.code,
        },
    };
    return safeDispatch(eventKey, message);
};

module.exports = {
    MANAGER_ROLES,
    notifyForestSnapshotCompleted,
    notifyForestSnapshotFailed,
    notifyFloodRunCompleted,
    notifyFloodRunFailed,
    notifyHydroScenarioTriggered,
    notifyHydroScenarioUpdated,
};
