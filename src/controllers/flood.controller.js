'use strict';

const service = require('../services/flood/analysis.service');
const weatherService = require('../services/flood/weather.service');
const eventDaily = require('../services/flood/event-daily.service');
const eventDailyJob = require('../jobs/flood-event-daily.job');
const { OK, CREATED, OK_LIST } = require('../core/success.response');
const { Api503Error } = require('../core/error.response');
const { buildActor } = require('../utils/actor.util');
const debug = require('../services/flood/debug.util');

const listResponse = (res, result, query, message) =>
    OK_LIST(res, message, result.items, {
        page: query.page,
        limit: query.limit,
        total: result.total,
    });

const overview = async (_req, res) => OK(res, 'Flood overview loaded', await service.overview());
const legends = async (_req, res) => OK(res, 'Flood legends loaded', service.getLegends());
const layers = async (req, res) =>
    listResponse(
        res,
        await service.listPublished(req.query),
        req.query,
        'Published flood layers loaded',
    );
const publicRuns = async (req, res) =>
    listResponse(
        res,
        await service.listPublicRuns(req.query),
        req.query,
        'Flood run history loaded',
    );

const dashboard = async (_req, res) =>
    OK(res, 'Flood dashboard loaded', await service.overview({ mode: null, onlySucceeded: false }));
const config = async (_req, res) => OK(res, 'Flood configuration loaded', service.getConfig());
const queue = async (_req, res) => OK(res, 'Flood queue state loaded', service.getQueueState());
const listRuns = async (req, res) =>
    listResponse(res, await service.listRuns(req.query), req.query, 'Flood runs loaded');
const getRun = async (req, res) =>
    OK(res, 'Flood run loaded', await service.getRunDetail(Number(req.params.id)));
const submit = async (req, res) => {
    debug.log('controller.submit received', {
        module: req.body?.module,
        mode: req.body?.mode,
        ip: req.ip,
    });
    const run = await service.submit(req.body, buildActor(req));
    debug.log('controller.submit response', { runId: run.id, status: run.status });
    return CREATED(res, 'Flood run queued', run);
};
const rerun = async (req, res) => {
    debug.log('controller.rerun received', { runId: req.params.id });
    const run = await service.rerun(Number(req.params.id), buildActor(req));
    debug.log('controller.rerun response', { newRunId: run.id });
    return CREATED(res, 'Flood rerun queued', run);
};
const cancel = async (req, res) => {
    debug.log('controller.cancel received', { runId: req.params.id });
    const cancelled = await service.cancel(Number(req.params.id), buildActor(req));
    debug.log('controller.cancel response', { runId: cancelled?.id, status: cancelled?.status });
    return OK(res, 'Flood run cancelled', cancelled);
};
const publishArtifact = async (req, res) => {
    debug.log('controller.publishArtifact received', { artifactId: req.params.id });
    const published = await service.publishArtifact(Number(req.params.id), buildActor(req));
    debug.log('controller.publishArtifact response', { artifactId: published?.id });
    return OK(res, 'Flood artifact publication queued', published);
};
const unpublishArtifact = async (req, res) => {
    debug.log('controller.unpublishArtifact received', { artifactId: req.params.id });
    const unpublished = await service.unpublishArtifact(Number(req.params.id), buildActor(req));
    debug.log('controller.unpublishArtifact response', { artifactId: unpublished?.id });
    return OK(res, 'Flood artifact unpublished', unpublished);
};

// Auto-fill button for the M3 rainfall form. Returns the OpenWeather nowcast
// at the Cẩm Phả center reshaped to match the run-form field names.
const currentWeather = async (_req, res) => {
    try {
        const bundle = await weatherService.getCurrentRainfallBundle();
        return OK(res, 'Đã lấy dữ liệu thời tiết hiện tại.', bundle);
    } catch (error) {
        if (error?.code === 'OPENWEATHER_NOT_CONFIGURED') {
            throw new Api503Error(
                'Chưa cấu hình khóa OpenWeather trên máy chủ.',
                ['OPENWEATHER_NOT_CONFIGURED'],
            );
        }
        throw error;
    }
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

// Kịch bản lượng mưa + thuỷ triều → lớp phủ dự báo (M6).
// Nhận payload { rainfall: { amount24h }, tideLevelM } (thuỷ triều là tùy chọn),
// tính toán trực tiếp và trả về lớp phủ dự báo tương ứng ngay lập tức (không qua GEE).
const forecastScenario = async (req, res) => {
    const config = req.body?.config || req.body || {};
    debug.log('controller.forecastScenario received', {
        rainfall24hMm: config?.rainfall?.amount24h,
        tideLevelM: config?.tideLevelM,
        ip: req.ip,
    });
    const result = await service.getForecastScenario(config);
    debug.log('controller.forecastScenario matched', {
        effectiveLevelM: result?.effectiveLevelM,
        matchedLayer: result?.matchedLayer?.code,
    });
    return OK(res, 'Kịch bản dự báo ngập lụt.', result);
};

module.exports = {
    overview,
    legends,
    layers,
    publicRuns,
    dashboard,
    config,
    queue,
    listRuns,
    getRun,
    submit,
    rerun,
    cancel,
    publishArtifact,
    unpublishArtifact,
    currentWeather,
    triggerDaily,
    forecastScenario,
};
