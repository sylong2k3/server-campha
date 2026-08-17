'use strict';

const service = require('../services/flood/analysis.service');
const eventDaily = require('../services/flood/event-daily.service');
const eventDailyJob = require('../jobs/flood-event-daily.job');
const { OK, CREATED, OK_LIST } = require('../core/success.response');
const { buildActor } = require('../utils/actor.util');
const { logActivity } = require('../utils/activityLogger.util');
const debug = require('../services/flood/debug.util');

const listResponse = (res, result, query, message) =>
    OK_LIST(res, message, result.items, {
        page: query.page,
        limit: query.limit,
        total: result.total,
    });

const overview = async (_req, res) => OK(res, 'Đã tải tổng quan ngập lụt', await service.overview());
const legends = async (req, res) =>
    OK(res, 'Đã tải chú giải ngập lụt', service.getLegends(req.query.module));

const adminLegends = async (req, res) =>
    OK(res, 'Đã tải chú giải ngập lụt (admin)', service.getAdminLegends(req.query.module ?? 'trend'));

const updateLegend = async (req, res) => {
    const actor = buildActor(req);
    const updated = service.updateLegend(req.params.code, req.body);
    logActivity('[FLOOD]', {
        userId: actor?.id,
        action: `flood:legend:update:${req.params.code}`,
        ipAddress: actor?.ipAddress,
        userAgent: actor?.userAgent,
        metadata: { code: req.params.code, patch: req.body },
    });
    return OK(res, 'Đã cập nhật chú giải', updated);
};

const resetLegend = async (req, res) => {
    const actor = buildActor(req);
    service.resetLegend(req.params.code);
    logActivity('[FLOOD]', {
        userId: actor?.id,
        action: `flood:legend:reset:${req.params.code}`,
        ipAddress: actor?.ipAddress,
        userAgent: actor?.userAgent,
        metadata: { code: req.params.code },
    });
    return OK(res, 'Đã khôi phục chú giải về mặc định');
};
const layers = async (req, res) =>
    listResponse(
        res,
        await service.listPublished(req.query),
        req.query,
        'Đã tải danh sách lớp ngập đã công bố',
    );
const publicRuns = async (req, res) =>
    listResponse(
        res,
        await service.listPublicRuns(req.query),
        req.query,
        'Đã tải lịch sử phân tích ngập',
    );

const dashboard = async (_req, res) =>
    OK(res, 'Đã tải bảng điều khiển ngập lụt', await service.overview({ mode: null, onlySucceeded: false }));
const config = async (_req, res) => OK(res, 'Đã tải cấu hình ngập lụt', service.getConfig());
const trendConfig = async (_req, res) => OK(res, 'Cấu hình mô hình xu thế FINAL', service.getTrendConfig());

const updateTrendConfig = async (req, res) =>
    OK(res, 'Đã cập nhật cấu hình mô hình', service.updateTrendConfig(req.body));

const resetTrendConfig = async (req, res) =>
    OK(res, 'Đã khôi phục cấu hình về mặc định', service.resetTrendConfig(req.params.key ?? null));
const queue = async (_req, res) => OK(res, 'Đã tải trạng thái hàng đợi', service.getQueueState());
const listRuns = async (req, res) =>
    listResponse(res, await service.listRuns(req.query), req.query, 'Đã tải danh sách lượt phân tích');
const getRun = async (req, res) =>
    OK(res, 'Đã tải chi tiết lượt phân tích', await service.getRunDetail(Number(req.params.id)));
const submit = async (req, res) => {
    debug.log('controller.submit received', {
        module: req.body?.module,
        mode: req.body?.mode,
        ip: req.ip,
    });
    const run = await service.submit(req.body, buildActor(req));
    debug.log('controller.submit response', { runId: run.id, status: run.status });
    return CREATED(res, 'Đã đưa lượt phân tích vào hàng đợi', run);
};
const rerun = async (req, res) => {
    debug.log('controller.rerun received', { runId: req.params.id });
    const run = await service.rerun(Number(req.params.id), buildActor(req));
    debug.log('controller.rerun response', { newRunId: run.id });
    return CREATED(res, 'Đã đưa lượt chạy lại vào hàng đợi', run);
};
const cancel = async (req, res) => {
    debug.log('controller.cancel received', { runId: req.params.id });
    const cancelled = await service.cancel(Number(req.params.id), buildActor(req));
    debug.log('controller.cancel response', { runId: cancelled?.id, status: cancelled?.status });
    return OK(res, 'Đã hủy lượt phân tích', cancelled);
};
const publishArtifact = async (req, res) => {
    debug.log('controller.publishArtifact received', { artifactId: req.params.id });
    const published = await service.publishArtifact(Number(req.params.id), buildActor(req));
    debug.log('controller.publishArtifact response', { artifactId: published?.id });
    return OK(res, 'Đã đưa yêu cầu công bố vào hàng đợi', published);
};
const unpublishArtifact = async (req, res) => {
    debug.log('controller.unpublishArtifact received', { artifactId: req.params.id });
    const unpublished = await service.unpublishArtifact(Number(req.params.id), buildActor(req));
    debug.log('controller.unpublishArtifact response', { artifactId: unpublished?.id });
    return OK(res, 'Đã thu hồi công bố artifact', unpublished);
};

// Manual "fire the daily cron now" for ops/testing. Returns the same
// structured result the cron logs on schedule. Idempotent via analysisKey.
const triggerDaily = async (_req, res) => {
    const settings = eventDailyJob.settings();
    const result = await eventDaily.runOnce({
        timezone: settings.timezone,
        lookbackDays: settings.lookbackDays,
        preStart: settings.preStart,
        preEnd: settings.preEnd,
    });
    return OK(res, 'Đã chạy quy trình phát hiện ngập hàng ngày.', result);
};

const simulation = async (req, res) => {
    const rainfall =
        req.query.rainfall ??
        req.body?.rainfall ??
        req.query.rainfall_mm ??
        req.body?.rainfall_mm;
    const tide = req.query.tide ?? req.body?.tide ?? req.query.tide_m ?? req.body?.tide_m;
    const result = await service.simulateFlood(
        { rainfall, tide },
        buildActor(req),
    );
    return OK(res, 'Mô phỏng ngập lụt thành công', result);
};

const listScenarios = async (req, res) => {
    const result = await service.listScenarios(req.query, buildActor(req));
    return OK_LIST(res, 'Danh sách kịch bản ngập úng', result.items, {
        page: result.pagination.page,
        limit: result.pagination.limit,
        total: result.pagination.total,
    });
};

const getScenario = async (req, res) => {
    const scenario = await service.getScenario(Number(req.params.id), buildActor(req));
    return OK(res, 'Chi tiết kịch bản ngập úng', scenario);
};

const createScenario = async (req, res) => {
    const scenario = await service.createScenario(req.body, buildActor(req));
    return CREATED(res, 'Tạo kịch bản ngập úng thành công', scenario);
};

const updateScenario = async (req, res) => {
    const scenario = await service.updateScenario(Number(req.params.id), req.body, buildActor(req));
    return OK(res, 'Cập nhật kịch bản ngập úng thành công', scenario);
};

const deleteScenario = async (req, res) => {
    await service.deleteScenario(Number(req.params.id));
    return OK(res, 'Xóa kịch bản ngập úng thành công');
};

module.exports = {
    overview,
    legends,
    adminLegends,
    updateLegend,
    resetLegend,
    layers,
    publicRuns,
    dashboard,
    config,
    trendConfig,
    updateTrendConfig,
    resetTrendConfig,
    queue,
    listRuns,
    getRun,
    submit,
    rerun,
    cancel,
    publishArtifact,
    unpublishArtifact,
    triggerDaily,
    simulation,
    listScenarios,
    getScenario,
    createScenario,
    updateScenario,
    deleteScenario,
};

