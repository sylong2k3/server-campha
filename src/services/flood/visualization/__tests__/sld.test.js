'use strict';

const { artifactCodeFromLayerCode, buildSld, isKnownArtifactCode, resolveKnownArtifactCode } = require('../sld');

// ── artifactCodeFromLayerCode ────────────────────────────────────────────────

describe('artifactCodeFromLayerCode — TREND_MONITORING_V1 format', () => {
    // Real registry codes from the published DB rows (api_res.txt, run 1 & 2)
    const monitoringCases = [
        ['fl_trend_flood_extent_2024_01_18_2024_08_18',       'flood_extent'],
        ['fl_trend_flood_extent_2025_01_18_2025_08_18',       'flood_extent'],
        ['fl_trend_pop_affected_2024_01_18_2024_08_18',       'pop_affected'],
        ['fl_trend_pop_affected_2025_01_18_2025_08_18',       'pop_affected'],
        ['fl_trend_crop_affected_2024_01_18_2024_08_18',      'crop_affected'],
        ['fl_trend_crop_affected_2025_01_18_2025_08_18',      'crop_affected'],
        ['fl_trend_built_affected_2024_01_18_2024_08_18',     'built_affected'],
        ['fl_trend_built_affected_2025_01_18_2025_08_18',     'built_affected'],
        ['fl_trend_encroachment_alert_2024_01_18_2024_08_18', 'encroachment_alert'],
        ['fl_trend_encroachment_alert_2025_01_18_2025_08_18', 'encroachment_alert'],
        ['fl_trend_drainage_sensitive_2024_01_18_2024_08_18', 'drainage_sensitive'],
        ['fl_trend_drainage_sensitive_2025_01_18_2025_08_18', 'drainage_sensitive'],
        ['fl_trend_pond_to_built_2024_01_18_2024_08_18',      'pond_to_built'],
        ['fl_trend_pond_to_built_2025_01_18_2025_08_18',      'pond_to_built'],
    ];

    test.each(monitoringCases)('%s → %s', (code, expected) => {
        expect(artifactCodeFromLayerCode(code)).toBe(expected);
    });
});

describe('artifactCodeFromLayerCode — legacy numeric-ID format', () => {
    const legacyCases = [
        ['fl_event_main_flood_non_tidal_r1',   'main_flood_non_tidal'],
        ['fl_event_open_water_r5',             'open_water'],
        ['fl_event_shallow_flood_r12',         'shallow_flood'],
        ['fl_hand_hand_scenario_r3',           'hand_scenario'],
        ['fl_hand_hand_depth_r3',              'hand_depth'],
        ['fl_rain_rain_risk_score_r7',         'rain_risk_score'],
        ['fl_rain_rain_risk_class_r7',         'rain_risk_class'],
        ['fl_impact_affected_population_r9',   'affected_population'],
        ['fl_impact_affected_cropland_r9',     'affected_cropland'],
        ['fl_impact_affected_built_r9',        'affected_built'],
        ['fl_trend_flood_extent_2025',         'flood_extent'],   // analysisYear tag
    ];

    test.each(legacyCases)('%s → %s', (code, expected) => {
        expect(artifactCodeFromLayerCode(code)).toBe(expected);
    });
});

describe('artifactCodeFromLayerCode — legacy alias', () => {
    test('fl_event_flood_main_r99 resolves via ARTIFACT_CODE_ALIASES → main_flood_non_tidal', () => {
        expect(artifactCodeFromLayerCode('fl_event_flood_main_r99')).toBe('main_flood_non_tidal');
    });

    test('fl_trend_flood_main_2024_01_18_2024_08_18 resolves via alias', () => {
        expect(artifactCodeFromLayerCode('fl_trend_flood_main_2024_01_18_2024_08_18')).toBe('main_flood_non_tidal');
    });
});

describe('artifactCodeFromLayerCode — unknown / invalid input → null', () => {
    test.each([
        ['fl_trend_unknown_artifact_2024_01_18', null],
        ['fl_trend_not_in_definitions_r1',       null],
        ['campha:some_other_layer',              null],
        ['flood_extent',                         null],   // raw artifact code without fl_ prefix
        ['encroachment_alert',                   null],
        ['',                                     null],
        [null,                                   null],
        [undefined,                              null],
        [42,                                     null],
    ])('%s → null', (input, expected) => {
        expect(artifactCodeFromLayerCode(input)).toBe(expected);
    });
});

// ── isKnownArtifactCode ──────────────────────────────────────────────────────

describe('isKnownArtifactCode', () => {
    test.each([
        ['flood_extent',       true],
        ['encroachment_alert', true],
        ['pond_to_built',      true],
        ['hand_depth',         true],
        ['rain_risk_class',    true],
    ])('%s → true', (code, expected) => {
        expect(isKnownArtifactCode(code)).toBe(expected);
    });

    test.each([
        [null,                false],
        ['',                  false],
        ['unknown_code',      false],
        ['flood_main',        false],  // alias key is NOT a known artifact code directly
    ])('%s → false', (code, expected) => {
        expect(isKnownArtifactCode(code)).toBe(expected);
    });
});

// ── resolveKnownArtifactCode ─────────────────────────────────────────────────

describe('resolveKnownArtifactCode', () => {
    test.each([
        ['flood_extent',          'flood_extent'],
        ['encroachment_alert',    'encroachment_alert'],
        ['pond_to_built',         'pond_to_built'],
        ['drainage_sensitive',    'drainage_sensitive'],
        ['pop_affected',          'pop_affected'],
        ['crop_affected',         'crop_affected'],
        ['built_affected',        'built_affected'],
        ['flood_main',            'main_flood_non_tidal'],  // alias
    ])('%s → %s', (code, expected) => {
        expect(resolveKnownArtifactCode(code)).toBe(expected);
    });

    test.each([
        [null,          null],
        [undefined,     null],
        ['',            null],
        ['not_a_code',  null],
    ])('%s → null', (code, expected) => {
        expect(resolveKnownArtifactCode(code)).toBe(expected);
    });
});

// ── buildSld ─────────────────────────────────────────────────────────────────

describe('buildSld', () => {
    test('returns null for unknown artifact code', () => {
        expect(buildSld('campha:test', 'not_defined')).toBeNull();
    });

    test('returns valid XML for flood_extent (binary)', () => {
        const sld = buildSld('campha:fl_trend_flood_extent_2024_01_18_2024_08_18', 'flood_extent');
        expect(sld).toContain('StyledLayerDescriptor');
        expect(sld).toContain('campha:fl_trend_flood_extent_2024_01_18_2024_08_18');
        expect(sld).toContain('RasterSymbolizer');
        expect(sld).toContain('ColorMap');
        // Binary ramp: transparent for nodata/0, opaque for flood pixels
        expect(sld).toContain('opacity="0"');
        expect(sld).toContain('opacity="1"');
    });

    test('flood_extent SLD uses the correct palette color', () => {
        const sld = buildSld('campha:flood', 'flood_extent');
        // Palette for flood_extent is ['1f78b4']
        expect(sld).toContain('#1f78b4');
    });

    test('encroachment_alert SLD uses the correct palette color', () => {
        const sld = buildSld('campha:test', 'encroachment_alert');
        expect(sld).toContain('#DE2D26');
    });

    test('pond_to_built SLD uses the correct palette color', () => {
        const sld = buildSld('campha:test', 'pond_to_built');
        expect(sld).toContain('#FEB24C');
    });

    test('drainage_sensitive SLD uses the correct palette color', () => {
        const sld = buildSld('campha:test', 'drainage_sensitive');
        expect(sld).toContain('#756BB1');
    });

    test('pop_affected SLD uses type=ramp (continuous gradient)', () => {
        const sld = buildSld('campha:test', 'pop_affected');
        expect(sld).toContain('type="ramp"');
        // Yellow → dark red gradient
        expect(sld).toContain('#FFFFB2');
        expect(sld).toContain('#BD0026');
    });

    test('rain_risk_class SLD uses type=values (classified)', () => {
        const sld = buildSld('campha:test', 'rain_risk_class');
        expect(sld).toContain('type="values"');
        expect(sld).toContain('quantity="1"');
        expect(sld).toContain('quantity="2"');
        expect(sld).toContain('quantity="3"');
    });

    test('hand_depth SLD uses type=ramp with 5 colour stops', () => {
        const sld = buildSld('campha:test', 'hand_depth');
        expect(sld).toContain('type="ramp"');
        const matches = [...sld.matchAll(/ColorMapEntry/g)];
        expect(matches).toHaveLength(5);
    });

    test('stratum SLD uses type=values (3 classes, 1..3)', () => {
        const sld = buildSld('campha:test', 'stratum');
        expect(sld).toContain('type="values"');
        expect(sld).toContain('quantity="1"');
        expect(sld).toContain('quantity="2"');
        expect(sld).toContain('quantity="3"');
    });

    test('SLD wraps NamedLayer with the given geoserverLayer name', () => {
        const layerName = 'campha:fl_trend_encroachment_alert_2025_01_18_2025_08_18';
        const sld = buildSld(layerName, 'encroachment_alert');
        expect(sld).toContain(`<Name>${layerName}</Name>`);
    });
});
