'use strict';

/**
 * Built-up impact — hectares of Dynamic World built class inside the flood.
 *
 * Uses the same DW context (mode composite) that M1 already builds via
 * `services/flood/common/dynamic-world.createRunCache`. The M4 orchestrator
 * passes the built mask straight through; this module just intersects with
 * the flood mask.
 *
 * @source docs/Flood_D_final.js (impact block:4078; built handling ≈4230)
 * @dataset ASSETS.DYNAMIC_WORLD
 * @rule    architecture doc §55 — record landcover source year
 */

const { ASSETS } = require('../common/datasets');
const { DW_CLASS } = require('../common/dynamic-world');

const BUILT_UP_SOURCE_TEMPLATE = Object.freeze({
    dataset: ASSETS.DYNAMIC_WORLD,
    version: 'V1',
    resolutionM: 10,
    provider: 'Google / WRI',
    // `year` filled in per-run by the orchestrator (Dynamic World composite year).
});

/**
 * Built-up mask (from DW) intersected with the flood mask.
 */
function affectedBuiltMask(ee, { floodMask, builtMask } = {}) {
    if (!ee) {throw new Error('impact.built-up.affectedBuiltMask requires the ee module');}
    if (!floodMask) {throw new Error('impact.built-up.affectedBuiltMask requires a floodMask');}
    if (!builtMask) {throw new Error('impact.built-up.affectedBuiltMask requires a builtMask');}
    return builtMask.and(floodMask).rename('affected_built');
}

/**
 * Build the provenance stamp for the given DW composite year.
 */
function buildBuiltSource(year) {
    return { ...BUILT_UP_SOURCE_TEMPLATE, year: Number.isFinite(year) ? year : null };
}

module.exports = {
    DW_BUILT_CLASS: DW_CLASS.BUILT,
    BUILT_UP_SOURCE_TEMPLATE,
    buildBuiltSource,
    affectedBuiltMask,
};
