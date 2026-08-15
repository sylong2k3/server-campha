'use strict';

const defaults = require('../defaults');
const versions = require('../versions');
const gate = require('../product-vs-calibration');
const { validateRunConfig, SCHEMAS } = require('../schema');

describe('defaults.js — thresholds locked from Flood_D_final.js', () => {
    test('S1_THRESHOLDS matches Flood_D lines 109–114 exactly', () => {
        expect(defaults.S1_THRESHOLDS).toEqual({
            vhDecreaseDb: 2.0,
            vvDecreaseDb: 0.8,
            vhRatio: 1.3,
            postVHDb: -18,
            postVVDb: -11,
            maximumRatio: 2.5,
        });
    });

    test('S1_DEFAULTS keeps the critical scientific caveats untouched', () => {
        // Flood_D:217 — urban double-bounce is DISABLED by default. Guarding
        // against silent flips per §15.
        expect(defaults.S1_DEFAULTS.enableUrbanDoubleBounce).toBe(false);
        // Flood_D:199 — eventMode ON by default.
        expect(defaults.S1_DEFAULTS.eventMode).toBe(true);
        // Flood_D:182–183 — hard slope + HAND caps as scientifically justified.
        expect(defaults.S1_DEFAULTS.hardMaximumSlope).toBe(5);
        expect(defaults.S1_DEFAULTS.hardMaximumHAND).toBe(12);
        // Flood_D:172 — threshold mode 'fixed' preferred over Otsu.
        expect(defaults.S1_DEFAULTS.thresholdMode).toBe('fixed');
    });

    test('RAIN_RISK_DEFAULTS threshold = 0.60 with PROBABILITY_CALIBRATED=false', () => {
        expect(defaults.RAIN_RISK_DEFAULTS.threshold).toBe(0.6);
        // §16 non-negotiable — this MUST remain false unless probabilistic
        // calibration is scientifically established.
        expect(defaults.RAIN_RISK_DEFAULTS.PROBABILITY_CALIBRATED).toBe(false);
    });

    test('IMPACT_DEFAULTS impactSource=M1, impactUseNonTidal=true', () => {
        expect(defaults.IMPACT_DEFAULTS.impactSource).toBe('M1');
        expect(defaults.IMPACT_DEFAULTS.impactUseNonTidal).toBe(true);
    });

    test('RUN_MODES enum matches the migration CHECK constraint', () => {
        expect(defaults.RUN_MODES).toEqual(['product', 'calibration']);
        expect(defaults.DEFAULT_RUN_MODE).toBe('product');
    });

    test('PROJECTION defaults to EPSG:32648 @ 30m', () => {
        expect(defaults.PROJECTION).toEqual({ crs: 'EPSG:32648', scaleM: 30 });
    });

    test('AOI defaults to REFERENCE_GAUL (per §82 provenance)', () => {
        expect(defaults.AOI_DEFAULTS.source).toBe('REFERENCE_GAUL');
    });

    test('every exported constant is frozen (guards against runtime mutation)', () => {
        for (const key of [
            'S1_THRESHOLDS',
            'S1_DEFAULTS',
            'RAIN_RISK_DEFAULTS',
            'IMPACT_DEFAULTS',
            'TREND_DEFAULTS',
            'RUN_MODES',
            'RUN_CONFIG_TOGGLES',
            'AOI_DEFAULTS',
            'PROJECTION',
        ]) {
            expect(Object.isFrozen(defaults[key])).toBe(true);
        }
    });
});

describe('versions.js', () => {
    test('pipelineVersionFor maps every module to a V1 constant', () => {
        expect(versions.pipelineVersionFor('event')).toBe('FLOOD_EVENT_V1');
        expect(versions.pipelineVersionFor('rain')).toBe('RAIN_RISK_V1');
        expect(versions.pipelineVersionFor('impact')).toBe('IMPACT_V1');
        expect(versions.pipelineVersionFor('trend')).toBe('TREND_V1');
    });

    test('pipelineVersionFor throws for an unknown module', () => {
        expect(() => versions.pipelineVersionFor('bogus')).toThrow(/Unknown flood module/);
    });

    test('CONFIG_VERSION is stamped as V1', () => {
        expect(versions.CONFIG_VERSION).toBe('V1');
    });
});

describe('product-vs-calibration.js — §19 gate', () => {
    test('canAutoPublish is true only for PRODUCT + SUCCEEDED runs', () => {
        expect(gate.canAutoPublish({ mode: 'product', status: 'SUCCEEDED' })).toBe(true);
        expect(gate.canAutoPublish({ mode: 'product', status: 'FAILED' })).toBe(false);
        expect(gate.canAutoPublish({ mode: 'calibration', status: 'SUCCEEDED' })).toBe(false);
        expect(gate.canAutoPublish(null)).toBe(false);
    });

    test('canManuallyPublish accepts PRODUCT + QA artifacts but not CALIBRATION', () => {
        expect(gate.canManuallyPublish({ artifact_role: 'PRODUCT' })).toBe(true);
        expect(gate.canManuallyPublish({ artifact_role: 'QA' })).toBe(true);
        expect(gate.canManuallyPublish({ artifact_role: 'CALIBRATION' })).toBe(false);
    });

    test('shouldEnableDiagnostics is true only in calibration mode', () => {
        expect(gate.shouldEnableDiagnostics({ mode: 'calibration' })).toBe(true);
        expect(gate.shouldEnableDiagnostics({ mode: 'product' })).toBe(false);
    });

    test('assertValidMode rejects an unknown mode', () => {
        expect(() => gate.assertValidMode('demo')).toThrow(/Unsupported flood run mode/);
    });
});

describe('schema.js validateRunConfig', () => {
    describe('event (M1)', () => {
        const validEvent = {
            preStart: '2024-01-01',
            preEnd: '2024-04-30',
            postStart: '2024-09-01',
            postEnd: '2024-09-30',
        };

        test('accepts a minimal valid event payload and stamps defaults', () => {
            const cfg = validateRunConfig('event', validEvent);
            expect(cfg.mode).toBe('product');
            expect(cfg.orbitPass).toBe('AUTO');
            expect(cfg.thresholdMode).toBe('fixed');
            expect(cfg.runImpactAfterM1).toBe(true);
        });

        test('rejects windows where end < start', () => {
            expect(() =>
                validateRunConfig('event', { ...validEvent, preEnd: '2023-12-01' }),
            ).toThrow(/preStart must be <= preEnd/);
        });

        test('rejects a half-set false-positive window', () => {
            expect(() =>
                validateRunConfig('event', {
                    ...validEvent,
                    falsePositivePostStart: '2024-12-01',
                }),
            ).toThrow(/falsePositive/);
        });

        test('rejects unknown keys (blocks smuggling of unvalidated EE inputs)', () => {
            expect(() =>
                validateRunConfig('event', {
                    ...validEvent,
                    extraSecretGeometry: 'FeatureCollection',
                }),
            ).toThrow(/extraSecretGeometry/);
        });
    });

    describe('impact (M4)', () => {
        test('accepts an empty body and applies defaults', () => {
            const cfg = validateRunConfig('impact', {});
            expect(cfg.impactSource).toBe('M1');
            expect(cfg.impactUseNonTidal).toBe(true);
        });
        test('rejects an impactSource not in M1/M3', () => {
            expect(() => validateRunConfig('impact', { impactSource: 'M99' })).toThrow();
        });
    });

    describe('trend (M5)', () => {
        test('accepts a minimal valid trend body', () => {
            const cfg = validateRunConfig('trend', {
                dryStart: '2023-01-01',
                dryEnd: '2023-04-30',
                periods: [
                    { start: '2023-07-01', end: '2023-07-31' },
                    { start: '2023-08-01', end: '2023-08-31' },
                ],
            });
            expect(cfg.periods).toHaveLength(2);
        });
        test('requires at least 2 periods', () => {
            expect(() =>
                validateRunConfig('trend', {
                    dryStart: '2023-01-01',
                    dryEnd: '2023-04-30',
                    periods: [{ start: '2023-07-01', end: '2023-07-31' }],
                }),
            ).toThrow();
        });
    });

    test('validateRunConfig throws for an unknown module', () => {
        expect(() => validateRunConfig('bogus', {})).toThrow(/Unknown flood module/);
    });

    test('SCHEMAS keys match the migration module CHECK enum', () => {
        expect(Object.keys(SCHEMAS)).toEqual(['event', 'hand', 'rain', 'impact', 'trend']);
    });
});
