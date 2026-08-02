'use strict';
const service = require('../services/spatial-statistics.service');
const { OK, CREATED } = require('../core/success.response');
const { buildActor } = require('../utils/actor.util');
const { t } = require('../utils/i18n.util');
const actor = (req) => buildActor(req);
const listSources = async (req, res) =>
    OK(
        res,
        t('statistics_sources_success', req.lang),
        await service.listSources(req.query, actor(req)),
    );
const areas = async (req, res) =>
    OK(
        res,
        t('statistics_areas_success', req.lang),
        await service.listAreas(req.query, actor(req)),
    );
const timeSeries = async (req, res) =>
    OK(
        res,
        t('statistics_timeseries_success', req.lang),
        await service.timeSeries(req.query, actor(req)),
    );
const compare = async (req, res) =>
    OK(
        res,
        t('statistics_compare_success', req.lang),
        await service.compare(req.query, actor(req)),
    );
const createSource = async (req, res) =>
    CREATED(
        res,
        t('statistics_source_created_success', req.lang),
        await service.createSource(req.body, actor(req)),
    );
const updateSource = async (req, res) =>
    OK(
        res,
        t('statistics_source_updated_success', req.lang),
        await service.updateSource(Number(req.params.id), req.body, actor(req)),
    );
const refresh = async (req, res) =>
    OK(
        res,
        t('statistics_refresh_success', req.lang),
        await service.refresh(Number(req.params.id), req.body, actor(req)),
    );
module.exports = { listSources, areas, timeSeries, compare, createSource, updateSource, refresh };
