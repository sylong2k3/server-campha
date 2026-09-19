'use strict';

const notificationService = require('./notification.service');
const systemLogger = require('../utils/systemLogger.util');
const { classifyScenario } = require('../repositories/flood-scenario.repository');

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

const resolveScenarioType = (scenario, layerCode) => {
    if (scenario?.type) {
        return scenario.type;
    }
    if (scenario) {
        return classifyScenario(scenario).type;
    }
    if (layerCode) {
        return classifyScenario({ layer_code: layerCode }).type;
    }
    return 'hien_trang';
};

const notifyHydroScenarioTriggered = async ({
    scenario,
    layerCode,
    rainVal,
    tideVal,
    eventHour,
    source = 'MANUAL',
} = {}) => {
    const scenarioType = resolveScenarioType(scenario, layerCode);
    if (scenarioType !== 'hien_trang') {
        systemLogger.logInfo(
            'notification_events',
            `Bỏ qua thông báo kích hoạt kịch bản: loại '${scenarioType}' không thuộc hiện trạng ngập lụt`,
            {
                scenarioId: scenario?.id,
                scenarioCode: scenario?.code,
                layerCode,
                type: scenarioType,
            },
        );
        return null;
    }

    const scenarioName = scenario?.name_vi || layerCode || 'Kịch bản thủy văn';
    const minRain = scenario?.min_rainfall ?? 0;
    const tideStr = tideVal != null ? `, triều ${tideVal} m` : '';
    const hourBucket = eventHour || new Date().toISOString().slice(0, 13);
    const identifier = scenario?.id || scenario?.code || layerCode || 'unknown';
    const eventKey = `hydro_scenario:${identifier}:${Math.round(rainVal)}:${hourBucket}`;

    const isAuto = source === 'AUTO' || source === 'FORECAST';
    const titlePrefix = isAuto
        ? 'Dự báo thời tiết kích hoạt kịch bản ngập lụt'
        : 'Cảnh báo kịch bản thủy văn';
    const actionDesc = isAuto ? 'Dự báo thời tiết' : 'Mô phỏng';

    const message = {
        type: 'hydro_scenario_triggered',
        title: `${titlePrefix}: ${scenarioName}`,
        body: `${actionDesc} lượng mưa ${rainVal} mm${tideStr} kích hoạt kịch bản '${scenarioName}' (ngưỡng tối thiểu ${minRain} mm). Lớp dữ liệu: ${scenario?.layer_code || layerCode}.`,
        data: {
            channel: 'flood',
            scenarioId: scenario?.id || null,
            scenarioCode: scenario?.code || null,
            layerCode: scenario?.layer_code || layerCode,
            rainfall: rainVal,
            tide: tideVal,
            source,
            hourBucket,
        },
    };
    return safeDispatch(eventKey, message);
};

const notifyHydroScenarioUpdated = async (scenario) => {
    // Theo quy định: chỉ phát thông báo khi kịch bản hiện trạng chuyển trạng thái kích hoạt,
    // thay đổi tham số kịch bản không phát thông báo.
    systemLogger.logInfo(
        'notification_events',
        `Bỏ qua thông báo cập nhật tham số kịch bản: chỉ thông báo khi kích hoạt kịch bản hiện trạng`,
        {
            scenarioId: scenario?.id,
            scenarioCode: scenario?.code,
        },
    );
    return null;
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
