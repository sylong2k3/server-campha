'use strict';

const layerDefs = require('../layer-definitions');
const legends = require('../legends');
const { createDiagnosticStore } = require('../../diagnostics/store');

describe('layer-definitions.js', () => {
    test('every M1..M5 artifact code is defined', () => {
        for (const code of [
            'main_flood_non_tidal',
            'open_water',
            'shallow_flood',
            'tidal_candidate',
            'mining_candidate',
            'urban_double_bounce',
            'rain_risk_score',
            'rain_risk_class',
            'affected_population',
            'affected_cropland',
            'affected_built',
            'trend_frequency',
            'trend_frequent_flood',
            'trend_new_flood',
            'pond_to_built',
            'drainage_sensitive',
            'encroachment_alert',
            'trend_tidal_candidate',
            'trend_mining_candidate',
        ]) {
            expect(layerDefs.ARTIFACT_LAYER_DEFINITIONS[code]).toBeDefined();
        }
    });

    test('every definition has palette, min, max and localised label', () => {
        for (const [code, def] of Object.entries(layerDefs.ARTIFACT_LAYER_DEFINITIONS)) {
            expect(Array.isArray(def.palette)).toBe(true);
            expect(def.palette.length).toBeGreaterThanOrEqual(1);
            expect(Number.isFinite(def.min)).toBe(true);
            expect(Number.isFinite(def.max)).toBe(true);
            expect(def.label.vi).toBeDefined();
            expect(def.label.en).toBeDefined();
            void code;
        }
    });

    test('every palette entry is a valid hex colour (3 or 6 hex chars)', () => {
        for (const def of Object.values(layerDefs.ARTIFACT_LAYER_DEFINITIONS)) {
            for (const hex of def.palette) {
                expect(hex).toMatch(/^[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/);
            }
        }
    });

    test('QA labels are marked "(QA)" (§43 visual distinction)', () => {
        for (const code of [
            'shallow_flood',
            'tidal_candidate',
            'mining_candidate',
            'urban_double_bounce',
        ]) {
            const def = layerDefs.ARTIFACT_LAYER_DEFINITIONS[code];
            expect(def.label.vi).toMatch(/QA/);
            expect(def.label.en).toMatch(/QA/);
        }
    });

    test('M3 risk labels never say "probability" (§16)', () => {
        for (const code of ['rain_risk_score', 'rain_risk_class']) {
            const def = layerDefs.ARTIFACT_LAYER_DEFINITIONS[code];
            expect(def.label.vi.toLowerCase()).not.toMatch(/xác suất/);
            expect(def.label.en.toLowerCase()).not.toMatch(/probability/);
        }
    });

    test('getLayerDefinition throws for unknown codes', () => {
        expect(() => layerDefs.getLayerDefinition('not_a_real_code')).toThrow();
    });

    test('listArtifactCodes returns all defined codes in module order', () => {
        const codes = layerDefs.listArtifactCodes();
        expect(codes[0]).toBe('main_flood_non_tidal'); // First M1 entry
        expect(codes[codes.length - 1]).toBe('trend_mining_candidate'); // Last M5 entry
        expect(new Set(codes).size).toBe(codes.length); // no duplicates
    });
});

describe('legends.js', () => {
    test('binary artifacts (min=max=1) render as a single-entry legend', () => {
        const legend = legends.buildLegend('main_flood_non_tidal');
        expect(legend.kind).toBe('binary');
        expect(legend.entries).toHaveLength(1);
        expect(legend.entries[0].color).toMatch(/^#/);
    });

    test('rain_risk_class is a 3-class band legend', () => {
        const legend = legends.buildLegend('rain_risk_class');
        expect(legend.kind).toBe('class');
        expect(legend.entries).toHaveLength(3);
        expect(legend.entries[0].value).toBe(1);
        expect(legend.entries[2].value).toBe(3);
    });

    test('rain_risk_score (0..1 continuous) renders as gradient with rounded ticks', () => {
        const legend = legends.buildLegend('rain_risk_score');
        expect(legend.kind).toBe('continuous');
        expect(legend.entries.length).toBeGreaterThan(1);
        expect(legend.entries[0].value).toBe(0);
        expect(legend.entries[legend.entries.length - 1].value).toBe(1);
    });

    test('buildAllLegends returns one entry per known artifact code', () => {
        const all = legends.buildAllLegends();
        expect(all).toHaveLength(layerDefs.listArtifactCodes().length);
    });

    test('buildLegend throws for unknown codes', () => {
        expect(() => legends.buildLegend('nope')).toThrow();
    });
});

describe('diagnostics/store.js', () => {
    test('createDiagnosticStore returns an independent store', () => {
        const a = createDiagnosticStore();
        const b = createDiagnosticStore();
        a.put('m1.stage', { note: 'a' });
        expect(a.size()).toBe(1);
        expect(b.size()).toBe(0);
    });

    test('put rejects empty prefix', () => {
        const s = createDiagnosticStore();
        expect(() => s.put('', {})).toThrow(/prefix/);
        expect(() => s.put('   ', {})).toThrow(/prefix/);
    });

    test('put stamps emittedAt and detail; multiple calls with same prefix keep both', () => {
        const s = createDiagnosticStore();
        s.put('m1.vote', { vote: 1 });
        s.put('m1.vote', { vote: 2 });
        const snap = s.snapshot();
        expect(snap).toHaveLength(2);
        expect(snap[0]).toMatchObject({ prefix: 'm1.vote', detail: { vote: 1 } });
        expect(new Date(snap[0].emittedAt).valueOf()).toBeGreaterThan(0);
    });

    test('put tolerates null / undefined detail (stores {})', () => {
        const s = createDiagnosticStore();
        s.put('m1.empty', null);
        s.put('m1.undefined', undefined);
        expect(s.snapshot().map((r) => r.detail)).toEqual([{}, {}]);
    });

    test('toJSON returns { entries, size } JSON-serialisable output', () => {
        const s = createDiagnosticStore();
        s.put('m1.threshold', { db: 2.0 });
        const json = s.toJSON();
        expect(json.size).toBe(1);
        expect(json.entries).toHaveLength(1);
        // Must round-trip through JSON
        expect(JSON.parse(JSON.stringify(json))).toEqual(json);
    });

    test('clear resets the store', () => {
        const s = createDiagnosticStore();
        s.put('x', {});
        s.put('y', {});
        s.clear();
        expect(s.size()).toBe(0);
    });
});
