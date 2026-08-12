'use strict';

/**
 * Static legend descriptors returned by the API for client rendering.
 *
 * These are derived from `layer-definitions.js` but shaped for the client's
 * legend widget (label + colour swatches, optional numeric ticks).
 *
 * @rule architecture doc §43 — visually distinguish QA layers from confirmed
 *       products (see the "QA" note on shallow/tidal/mining/urban entries).
 */

const {
    ARTIFACT_LAYER_DEFINITIONS,
    listArtifactCodes,
} = require('./layer-definitions');

/**
 * Build a legend for a single artifact.
 *
 * Shape returned:
 *   {
 *     code: string,
 *     label: { vi, en },
 *     kind: 'binary' | 'continuous' | 'class',
 *     entries: [{ color, label?, value? }],
 *     min?: number,
 *     max?: number,
 *   }
 */
function buildLegend(artifactCode) {
    const def = ARTIFACT_LAYER_DEFINITIONS[artifactCode];
    if (!def) {
        throw new Error(`visualization.buildLegend: no definition for '${artifactCode}'`);
    }
    const palette = def.palette || [];
    const isBinary = def.min === 1 && def.max === 1;
    const isSingleColor = palette.length === 1;
    if (isBinary || isSingleColor) {
        return {
            code: artifactCode,
            label: def.label,
            kind: 'binary',
            entries: [{ color: `#${palette[0]}`, label: def.label }],
            min: def.min,
            max: def.max,
        };
    }
    // Class band — integer range where the palette has exactly one entry
    // per class (e.g. rain_risk_class 1..3 with 3 palette hexes). Rules out
    // continuous 0..1 gradients that happen to fit inside a small range.
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
            label: def.label,
            kind: 'class',
            entries,
            min: def.min,
            max: def.max,
        };
    }
    // Continuous gradient — publish evenly-spaced ticks between min and max.
    const entries = palette.map((hex, idx) => {
        const t = palette.length === 1 ? 0 : idx / (palette.length - 1);
        const value = def.min + (def.max - def.min) * t;
        return { color: `#${hex}`, value: Math.round(value * 100) / 100 };
    });
    return {
        code: artifactCode,
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
 */
function buildAllLegends() {
    return listArtifactCodes().map(buildLegend);
}

module.exports = { buildLegend, buildAllLegends };
