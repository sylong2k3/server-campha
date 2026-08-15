'use strict';

const { ARTIFACT_LAYER_DEFINITIONS } = require('./layer-definitions');

/**
 * Legacy layer-code aliases — maps old artifact codes (written to the DB
 * before a rename) to their current ARTIFACT_LAYER_DEFINITIONS key.
 */
const ARTIFACT_CODE_ALIASES = Object.freeze({
    flood_main: 'main_flood_non_tidal',
});

/**
 * Extract artifact_code from a flood layer registry code.
 * Layer codes follow the pattern: fl_{module}_{artifact_code}_{artifact_id}
 * Resolves any known aliases before returning.
 */
function artifactCodeFromLayerCode(layerCode) {
    const m = String(layerCode || '').match(
        /^fl_(?:event|hand|rain|impact|trend)_(.+)_\d+$/,
    );
    if (!m) return null;
    const raw = m[1];
    return ARTIFACT_CODE_ALIASES[raw] || raw;
}

function buildColorMap(def) {
    const palette = def.palette || [];
    const isBinary = def.min === 1 && def.max === 1;

    if (isBinary || palette.length === 1) {
        // Only value=1 gets a color; all other values (nodata, 0) render transparent.
        return (
            `<ColorMap type="values">` +
            `<ColorMapEntry color="#${palette[0]}" quantity="1" opacity="1"/>` +
            `</ColorMap>`
        );
    }

    const expectedClassEntries = def.max - def.min + 1;
    const isClassBand =
        Number.isInteger(def.min) &&
        Number.isInteger(def.max) &&
        def.max > def.min &&
        expectedClassEntries === palette.length &&
        expectedClassEntries <= 10;

    if (isClassBand) {
        const entries = palette
            .map(
                (hex, idx) =>
                    `<ColorMapEntry color="#${hex}" quantity="${def.min + idx}" opacity="1"/>`,
            )
            .join('');
        return `<ColorMap type="values">${entries}</ColorMap>`;
    }

    // Continuous gradient — interpolate palette across [min, max].
    const entries = palette
        .map((hex, idx) => {
            const t = palette.length === 1 ? 0 : idx / (palette.length - 1);
            const quantity = Math.round((def.min + (def.max - def.min) * t) * 10000) / 10000;
            return `<ColorMapEntry color="#${hex}" quantity="${quantity}" opacity="1"/>`;
        })
        .join('');
    return `<ColorMap type="ramp">${entries}</ColorMap>`;
}

/**
 * Build a GeoServer SLD XML string for a flood artifact layer.
 * Returns null when no definition exists for the artifact code.
 *
 * The generated SLD overrides the layer's GeoServer-side style, so no
 * persistent SLD needs to exist in GeoServer — the proxy injects it per
 * request via the WMS SLD_BODY parameter.
 *
 * @param {string} geoserverLayer - full layer name e.g. 'workspace:layer'
 * @param {string} artifactCode   - e.g. 'pond_to_built', 'hand_depth'
 */
function buildSld(geoserverLayer, artifactCode) {
    const def = ARTIFACT_LAYER_DEFINITIONS[artifactCode];
    if (!def) return null;
    const colorMap = buildColorMap(def);
    return (
        `<?xml version="1.0" encoding="UTF-8"?>` +
        `<StyledLayerDescriptor version="1.0.0"` +
        ` xmlns="http://www.opengis.net/sld"` +
        ` xmlns:ogc="http://www.opengis.net/ogc"` +
        ` xmlns:xlink="http://www.w3.org/1999/xlink"` +
        ` xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">` +
        `<NamedLayer><Name>${geoserverLayer}</Name>` +
        `<UserStyle><FeatureTypeStyle><Rule>` +
        `<RasterSymbolizer>` +
        `<ChannelSelection><GrayChannel><SourceChannelName>1</SourceChannelName></GrayChannel></ChannelSelection>` +
        colorMap +
        `</RasterSymbolizer>` +
        `</Rule></FeatureTypeStyle></UserStyle>` +
        `</NamedLayer></StyledLayerDescriptor>`
    );
}

/**
 * Returns true when the string is a recognized flood artifact code
 * that has a palette definition, so the proxy can apply an SLD without
 * needing to rely on the layer's category column.
 */
function isKnownArtifactCode(code) {
    return typeof code === 'string' && code.trim() !== '' && code.trim() in ARTIFACT_LAYER_DEFINITIONS;
}

module.exports = { buildSld, artifactCodeFromLayerCode, isKnownArtifactCode };
