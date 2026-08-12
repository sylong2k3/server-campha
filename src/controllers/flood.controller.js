'use strict';

const service = require('../services/flood/analysis.service');
const { OK, CREATED, OK_LIST } = require('../core/success.response');
const { buildActor } = require('../utils/actor.util');

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
const submit = async (req, res) =>
    CREATED(res, 'Flood run queued', await service.submit(req.body, buildActor(req)));
const rerun = async (req, res) =>
    CREATED(res, 'Flood rerun queued', await service.rerun(Number(req.params.id), buildActor(req)));
const cancel = async (req, res) =>
    OK(res, 'Flood run cancelled', await service.cancel(Number(req.params.id), buildActor(req)));
const publishArtifact = async (req, res) =>
    OK(
        res,
        'Flood artifact publication queued',
        await service.publishArtifact(Number(req.params.id), buildActor(req)),
    );
const unpublishArtifact = async (req, res) =>
    OK(
        res,
        'Flood artifact unpublished',
        await service.unpublishArtifact(Number(req.params.id), buildActor(req)),
    );

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
};
