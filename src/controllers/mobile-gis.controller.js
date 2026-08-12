'use strict';
const service = require('../services/mobile-gis.service');
const routingService = require('../services/mobile-routing.service');
const editService = require('../services/mobile-feature-edit.service');
const { OK, CREATED, OK_LIST } = require('../core/success.response');
const { buildActor } = require('../utils/actor.util');
const { t } = require('../utils/i18n.util');
const tile = async (req, res) => {
    const y = Number(req.params.y.slice(0, -4)),
        buffer = await service.tile(
            Number(req.params.layerId),
            Number(req.params.z),
            Number(req.params.x),
            y,
            buildActor(req),
        );
    return res
        .set({
            'Content-Type': 'application/vnd.mapbox-vector-tile',
            'Cache-Control': req.user ? 'private, max-age=60' : 'public, max-age=300',
        })
        .status(200)
        .send(buffer);
};
const feature = (req, res) =>
    service
        .feature(Number(req.params.layerId), req.params.featureId, buildActor(req))
        .then((data) => OK(res, t('mobile_feature_success', req.lang), data));
const nearby = (req, res) =>
    service
        .nearby(Number(req.params.layerId), req.query, buildActor(req))
        .then((data) => OK(res, t('mobile_nearby_success', req.lang), data));
const measure = (req, res) =>
    service
        .measure(req.body, buildActor(req))
        .then((data) => OK(res, t('mobile_measure_success', req.lang), data));
const createDraft = (req, res) =>
    service
        .createDraft(req.body, buildActor(req))
        .then((data) => CREATED(res, t('mobile_draft_created_success', req.lang), data));
const listDrafts = async (req, res) => {
    const data = await service.listDrafts(req.query, buildActor(req));
    return OK_LIST(res, t('mobile_drafts_success', req.lang), data.items, {
        ...req.query,
        total: data.total,
    });
};
const getDraft = (req, res) =>
    service
        .getDraft(Number(req.params.id), buildActor(req))
        .then((data) => OK(res, t('mobile_drafts_success', req.lang), data));
const removeDraft = (req, res) =>
    service
        .removeDraft(Number(req.params.id), req.query, buildActor(req))
        .then((data) => OK(res, t('mobile_draft_deleted_success', req.lang), data));
const weather = (req, res) =>
    service
        .currentWeather(req.query, buildActor(req))
        .then((data) => OK(res, t('mobile_weather_success', req.lang), data));
const route = (req, res) =>
    routingService
        .shortest(req.body, buildActor(req))
        .then((data) => OK(res, t('mobile_route_success', req.lang), data));
const updateFeature = (req, res) =>
    editService
        .update(Number(req.params.layerId), req.params.featureId, req.body, buildActor(req))
        .then((data) => OK(res, t('mobile_feature_updated_success', req.lang), data));
const featureHistory = (req, res) =>
    editService
        .history(Number(req.params.layerId), req.params.featureId, buildActor(req))
        .then((data) => OK(res, t('mobile_feature_history_success', req.lang), data));
const restoreFeature = (req, res) =>
    editService
        .restore(
            Number(req.params.layerId),
            req.params.featureId,
            Number(req.params.version),
            req.body,
            buildActor(req),
        )
        .then((data) => OK(res, t('mobile_feature_restored_success', req.lang), data));
const sync = (req, res) =>
    editService
        .sync(req.body, buildActor(req))
        .then((data) => OK(res, t('mobile_sync_success', req.lang), data));
module.exports = {
    tile,
    feature,
    nearby,
    measure,
    createDraft,
    listDrafts,
    getDraft,
    removeDraft,
    weather,
    route,
    updateFeature,
    featureHistory,
    restoreFeature,
    sync,
};
