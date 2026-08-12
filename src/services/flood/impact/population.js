'use strict';

/**
 * Population impact — how many people live in the flooded area.
 *
 * Uses JRC GHSL population 2020 at ~100 m. The flood mask is reduced to the
 * GHSL projection (mean over each ~100 m cell), then multiplied back so
 * partial-flood cells contribute proportionally (Flood_D:1242–1254). This is
 * the same heuristic the reference project uses; it's approximate — do NOT
 * claim sub-100-m population counts.
 *
 * @source docs/Flood_D_final.js (`createPopulationFloodFraction`:1238; impact block:4078)
 * @dataset ASSETS.GHSL_POP_2020
 * @rule    architecture doc §55 — record `population_source_year` in every result
 */

const { ASSETS } = require('../common/datasets');

/** GHSL population dataset provenance stamp (baked into every M4 result). */
const POPULATION_SOURCE = Object.freeze({
    dataset: ASSETS.GHSL_POP_2020,
    year: 2020,
    version: 'P2023A',
    resolutionM: 100,
    provider: 'JRC',
});

/**
 * Load the GHSL population image (people-per-pixel).
 */
function loadPopulationImage(ee) {
    if (!ee) {
        throw new Error('impact.population.loadPopulationImage requires the ee module');
    }
    return ee.Image(ASSETS.GHSL_POP_2020);
}

/**
 * Population-weighted flood fraction — for each ~100 m GHSL pixel, take the
 * MEAN of the flood mask (0..1). Multiplied by population later; here we
 * only compute the fraction image.
 */
function floodFractionAtPopScale(ee, { floodMask, populationImage = null } = {}) {
    if (!ee) {
        throw new Error('impact.population.floodFractionAtPopScale requires the ee module');
    }
    if (!floodMask) {
        throw new Error('impact.population.floodFractionAtPopScale requires a floodMask');
    }
    const pop = populationImage || loadPopulationImage(ee);
    return floodMask
        .unmask(0)
        .reduceResolution(ee.Reducer.mean(), true)
        .reproject(pop.projection())
        .rename('flood_fraction');
}

/**
 * Affected-population image: floodFraction × population. Reduce over the AOI
 * to get an integer count.
 */
function affectedPopulationImage(ee, { floodMask, populationImage = null } = {}) {
    if (!ee) {
        throw new Error('impact.population.affectedPopulationImage requires the ee module');
    }
    if (!floodMask) {
        throw new Error('impact.population.affectedPopulationImage requires a floodMask');
    }
    const pop = populationImage || loadPopulationImage(ee);
    const fraction = floodFractionAtPopScale(ee, { floodMask, populationImage: pop });
    return fraction.multiply(pop).rename('affected_population');
}

module.exports = {
    POPULATION_SOURCE,
    loadPopulationImage,
    floodFractionAtPopScale,
    affectedPopulationImage,
};
