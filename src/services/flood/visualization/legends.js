'use strict';

/**
 * Static legend descriptors returned by the API for client rendering.
 *
 * These are derived from `layer-definitions.js` but shaped for the client's
 * legend widget (label + colour swatches, optional numeric ticks).
 *
 * Overrides stored in `legend-store.js` (JSON file) take precedence over the
 * compiled defaults, allowing admin-side edits without a redeploy.
 *
 * @rule architecture doc §43 — visually distinguish QA layers from confirmed
 *       products (see the "QA" note on shallow/tidal/mining/urban entries).
 */

const { ARTIFACT_LAYER_DEFINITIONS, ARTIFACT_MODULE_MAP, listArtifactCodes } = require('./layer-definitions');
const legendStore = require('./legend-store');

/**
 * Merge compiled defaults with any persisted admin override for an artifact.
 */
function _resolveDefinition(artifactCode) {
    const base = ARTIFACT_LAYER_DEFINITIONS[artifactCode];
    if (!base) throw new Error(`visualization.buildLegend: no definition for '${artifactCode}'`);
    const override = legendStore.getOverride(artifactCode);
    if (!override) return base;
    return {
        palette: override.palette ?? base.palette,
        min: override.min ?? base.min,
        max: override.max ?? base.max,
        label: override.label ?? base.label,
    };
}

/**
 * Build a legend for a single artifact.
 *
 * Shape returned:
 *   {
 *     code: string,
 *     module: string,
 *     label: { vi, en },
 *     kind: 'binary' | 'continuous' | 'class',
 *     entries: [{ color, label?, value? }],
 *     min?: number,
 *     max?: number,
 *   }
 */
function buildLegend(artifactCode) {
    const def = _resolveDefinition(artifactCode);
    const palette = def.palette || [];
    const isBinary = def.min === 1 && def.max === 1;
    const isSingleColor = palette.length === 1;
    if (isBinary || isSingleColor) {
        return {
            code: artifactCode,
            module: ARTIFACT_MODULE_MAP[artifactCode] ?? null,
            label: def.label,
            kind: 'binary',
            entries: [{ color: `#${palette[0]}`, label: def.label }],
            min: def.min,
            max: def.max,
        };
    }
    const expectedClassEntries = def.max - def.min + 1;
    const isClassBand =
        Number.isInteger(def.min) &&
        Number.isInteger(def.max) &&
        def.max > def.min &&
        expectedClassEntries === palette.length &&
        expectedClassEntries <= 10;
    if (isClassBand) {
        const entries = palette.map((hex, idx) => ({
            color: `#${hex}`,
            value: def.min + idx,
            label: undefined,
        }));
        return {
            code: artifactCode,
            module: ARTIFACT_MODULE_MAP[artifactCode] ?? null,
            label: def.label,
            kind: 'class',
            entries,
            min: def.min,
            max: def.max,
        };
    }
    const entries = palette.map((hex, idx) => {
        const t = palette.length === 1 ? 0 : idx / (palette.length - 1);
        const value = def.min + (def.max - def.min) * t;
        return { color: `#${hex}`, value: Math.round(value * 100) / 100 };
    });
    return {
        code: artifactCode,
        module: ARTIFACT_MODULE_MAP[artifactCode] ?? null,
        label: def.label,
        kind: 'continuous',
        entries,
        min: def.min,
        max: def.max,
    };
}

/**
 * Build legends for every artifact this domain knows about. Used by the
 * client's legend-preload flow so a single fetch returns everything.
 * @param {string} [module] Optional module filter ('event'|'hand'|'rain'|'impact'|'trend').
 */
function buildAllLegends(module) {
    const codes = listArtifactCodes();
    const filtered = module ? codes.filter(c => ARTIFACT_MODULE_MAP[c] === module) : codes;
    return filtered.map(buildLegend);
}

/**
 * Build a legend entry annotated with current override metadata for admin display.
 */
function buildAdminLegend(artifactCode) {
    const legend = buildLegend(artifactCode);
    const override = legendStore.getOverride(artifactCode);
    return { ...legend, hasOverride: override !== null };
}

function buildAllAdminLegends(module) {
    const codes = listArtifactCodes();
    const filtered = module ? codes.filter(c => ARTIFACT_MODULE_MAP[c] === module) : codes;
    return filtered.map(buildAdminLegend);
}

module.exports = { buildLegend, buildAllLegends, buildAdminLegend, buildAllAdminLegends };
