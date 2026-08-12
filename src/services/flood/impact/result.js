'use strict';

/**
 * M4 impact result catalog + metadata builder.
 *
 * M4 is PRIMARILY STATISTICAL — per architecture doc §54, we do NOT publish
 * rasters by default. The output is a metrics JSON that the client renders
 * as cards + charts. Individual masks (population fraction, cropland, etc)
 * are exposed as QA artifacts so admins can inspect them in the map.
 *
 * @rule architecture doc §54 (no raster publication by default)
 * @rule §55 — every result MUST identify data-source (year, version, provider)
 */

const { POPULATION_SOURCE } = require('./population');
const { CROPLAND_SOURCE } = require('./cropland');
const { LANDCOVER_SOURCE } = require('./landcover');
const { buildBuiltSource } = require('./built-up');

/**
 * QA raster artifacts (admin-only overlays). Not published in product mode.
 */
const M4_QA_ARTIFACTS = Object.freeze([
    {
        code: 'affected_population',
        role: 'QA',
        label: {
            vi: 'Dân cư bị ảnh hưởng',
            en: 'Affected population',
        },
        description: 'Population image weighted by flood fraction (per 100 m GHSL cell).',
        style: 'affected_population',
    },
    {
        code: 'affected_cropland',
        role: 'QA',
        label: {
            vi: 'Đất trồng trọt bị ảnh hưởng',
            en: 'Affected cropland',
        },
        description: 'Binary mask — WorldCover cropland class intersected with flood.',
        style: 'affected_cropland',
    },
    {
        code: 'affected_built',
        role: 'QA',
        label: {
            vi: 'Khu vực đô thị bị ảnh hưởng',
            en: 'Affected built-up',
        },
        description: 'Binary mask — Dynamic World built class intersected with flood.',
        style: 'affected_built',
    },
]);

const CODE_TO_ARTIFACT = Object.freeze(Object.fromEntries(M4_QA_ARTIFACTS.map((a) => [a.code, a])));

function selectM4Artifacts({ runMode = 'product' } = {}) {
    return M4_QA_ARTIFACTS.map((a) => ({
        ...a,
        // In calibration mode admin explicitly wants to see the QA masks.
        role: runMode === 'calibration' ? 'CALIBRATION' : 'QA',
    }));
}

/**
 * Build the M4 result metadata JSON — the primary output surface.
 *
 * @param {object} args
 * @param {string} args.sourceType             — 'M1' | 'M2' | 'M3'
 * @param {number} [args.sourceRunId]          — flood_analysis_runs.id of the source
 * @param {number} [args.floodAreaHa]
 * @param {number} [args.affectedPopulation]
 * @param {number} [args.affectedCroplandHa]
 * @param {number} [args.affectedBuiltHa]
 * @param {Array}  [args.landcoverBreakdown]   — [{class, label, areaHa}, ...]
 * @param {number} [args.dwCompositeYear]      — Dynamic World composite year (for built provenance)
 * @param {Array}  [args.warnings]
 */
function buildM4ResultMetadata({
    sourceType,
    sourceRunId = null,
    floodAreaHa = null,
    affectedPopulation = null,
    affectedCroplandHa = null,
    affectedBuiltHa = null,
    landcoverBreakdown = [],
    dwCompositeYear = null,
    warnings = [],
} = {}) {
    return {
        sourceType: sourceType || null,
        sourceRunId: Number.isFinite(sourceRunId) ? sourceRunId : null,
        floodAreaHa: Number.isFinite(floodAreaHa) ? floodAreaHa : null,
        affectedPopulation: Number.isFinite(affectedPopulation)
            ? Math.round(affectedPopulation)
            : null,
        affectedCroplandHa: Number.isFinite(affectedCroplandHa) ? affectedCroplandHa : null,
        affectedBuiltHa: Number.isFinite(affectedBuiltHa) ? affectedBuiltHa : null,
        landcoverBreakdown: Array.isArray(landcoverBreakdown) ? landcoverBreakdown : [],
        // Data-source stamps (§55 provenance rule).
        sources: {
            population: POPULATION_SOURCE,
            cropland: CROPLAND_SOURCE,
            landcover: LANDCOVER_SOURCE,
            builtUp: buildBuiltSource(dwCompositeYear),
        },
        warnings: Array.isArray(warnings) ? warnings : [],
    };
}

module.exports = {
    M4_QA_ARTIFACTS,
    CODE_TO_ARTIFACT,
    selectM4Artifacts,
    buildM4ResultMetadata,
};
