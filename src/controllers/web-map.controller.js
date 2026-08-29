'use strict';

const service = require('../services/web-map.service');
const { OK } = require('../core/success.response');
const { buildActor } = require('../utils/actor.util');
const { t } = require('../utils/i18n.util');

const listLayers = async (req, res) =>
    OK(
        res,
        t('web_map_layers_success', req.lang),
        await service.listLayers(req.query, buildActor(req)),
    );
const listTimeSeriesLayers = async (req, res) =>
    OK(
        res,
        t('web_map_layers_success', req.lang),
        await service.listTimeSeriesLayers(buildActor(req)),
    );
const getFeature = async (req, res) =>
    OK(
        res,
        t('web_map_feature_success', req.lang),
        await service.getFeature(
            Number(req.params.layerId),
            req.params.featureId,
            req.query.includeGeometry,
            buildActor(req),
        ),
    );
const searchFeatures = async (req, res) =>
    OK(
        res,
        t('web_map_search_success', req.lang),
        await service.searchFeatures(req.query, buildActor(req)),
    );
const getLegend = async (req, res) =>
    OK(
        res,
        t('web_map_legend_success', req.lang),
        await service.getLegend(Number(req.params.layerId), buildActor(req)),
    );
const listBasemaps = async (req, res) =>
    OK(res, t('web_map_basemaps_success', req.lang), await service.listBasemaps(buildActor(req)));
const listTerrain = async (req, res) =>
    OK(res, t('web_map_terrain_success', req.lang), await service.listTerrain(buildActor(req)));
const getTerrainUrl = async (req, res) =>
    OK(
        res,
        t('web_map_terrain_url_success', req.lang),
        await service.getTerrainUrl(
            Number(req.params.layerId),
            req.query.expireSeconds,
            buildActor(req),
        ),
    );

module.exports = {
    listLayers,
    listTimeSeriesLayers,
    getFeature,
    searchFeatures,
    getLegend,
    listBasemaps,
    listTerrain,
    getTerrainUrl,
};
