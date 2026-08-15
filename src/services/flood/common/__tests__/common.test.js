'use strict';

const datasets = require('../datasets');
const projection = require('../projection');
const geometry = require('../geometry');

describe('datasets.js', () => {
    test('exposes the 13 Earth Engine assets the flood domain consumes', () => {
        expect(Object.keys(datasets.ASSETS)).toEqual(
            expect.arrayContaining([
                'FAO_GAUL_LEVEL2',
                'SENTINEL1_GRD',
                'SENTINEL2_SR_HARMONIZED',
                'CLOUD_SCORE_PLUS',
                'DYNAMIC_WORLD',
                'WORLDCOVER',
                'JRC_GSW',
                'MERIT_HYDRO',
                'FABDEM',
                'COPERNICUS_DEM_GLO30',
                'GHSL_POP_2020',
                'IMERG_V07',
                'CHIRPS_DAILY_RNL',
            ]),
        );
    });

    test('every asset ID is a non-empty string', () => {
        for (const [name, id] of Object.entries(datasets.ASSETS)) {
            expect(typeof id).toBe('string');
            expect(id.length).toBeGreaterThan(3);
            // FE tests earlier confirmed uppercase/nested identifiers are accepted.
            // Just sanity check we didn't accidentally leak a placeholder.
            expect(id).not.toContain('TODO');
            if (!id) {
                throw new Error(`ASSET ${name} is empty`);
            }
        }
    });

    test('flags FABDEM as NON_COMMERCIAL', () => {
        expect(datasets.NON_COMMERCIAL.has(datasets.ASSETS.FABDEM)).toBe(true);
        expect(datasets.NON_COMMERCIAL.has(datasets.ASSETS.SENTINEL1_GRD)).toBe(false);
    });

    test('ATTRIBUTIONS is a frozen array of citation strings', () => {
        expect(Array.isArray(datasets.ATTRIBUTIONS)).toBe(true);
        expect(datasets.ATTRIBUTIONS.length).toBeGreaterThanOrEqual(10);
        expect(Object.isFrozen(datasets.ATTRIBUTIONS)).toBe(true);
    });
});

describe('projection.js', () => {
    test('analysis CRS is EPSG:32648 (UTM 48N, Cẩm Phả zone)', () => {
        expect(projection.ANALYSIS_CRS).toBe('EPSG:32648');
    });
    test('analysis scale defaults to 30 m for M1–M5 (M5 kept at 30 m to stay under GEE getDownloadURL quota)', () => {
        expect(projection.ANALYSIS_SCALE_M).toBe(30);
        expect(projection.TREND_ANALYSIS_SCALE_M).toBe(30);
    });
    test('CLIENT_BASEMAP_CRS is WGS84', () => {
        expect(projection.CLIENT_BASEMAP_CRS).toBe('EPSG:4326');
    });
    test('reducer max pixels matches Flood_D:254', () => {
        expect(projection.REDUCE_MAX_PIXELS).toBe(1e10);
    });
});

describe('geometry.js', () => {
    /**
     * Fake ee that records every call — enough to verify our filter construction
     * without needing the real @google/earthengine module.
     */
    const makeFakeEe = () => {
        const calls = [];
        const proxy =
            (name) =>
            (...args) => {
                calls.push({ name, args });
                return {
                    filter: (f) => ({
                        ...proxy('FeatureCollection.filter')(f),
                        geometry: proxy('geometry'),
                    }),
                    geometry: proxy('geometry'),
                    __name: name,
                    __args: args,
                };
            };
        const fake = {
            FeatureCollection: proxy('FeatureCollection'),
            Feature: proxy('Feature'),
            Geometry: proxy('Geometry'),
            Filter: {
                eq: proxy('Filter.eq'),
                and: proxy('Filter.and'),
            },
            calls,
        };
        return fake;
    };

    test('loadAoi throws without an ee module', () => {
        expect(() => geometry.loadAoi(null)).toThrow(/requires the ee module/);
    });

    test('default GAUL filter targets Cẩm Phả township with ADM0/1/2 filters', () => {
        const ee = makeFakeEe();
        const { source } = geometry.loadAoi(ee);
        expect(source).toBe('REFERENCE_GAUL');
        const eqCalls = ee.calls.filter((c) => c.name === 'Filter.eq');
        expect(eqCalls).toHaveLength(3);
        expect(eqCalls.map((c) => c.args)).toEqual(
            expect.arrayContaining([
                ['ADM0_NAME', 'Viet Nam'],
                ['ADM1_NAME', 'Quang Ninh'],
                ['ADM2_NAME', 'Cam Pha Township'],
            ]),
        );
        expect(ee.calls.some((c) => c.name === 'Filter.and')).toBe(true);
    });

    test('authoritative override tags aoiSource as AUTHORITATIVE and skips GAUL', () => {
        const ee = makeFakeEe();
        const geo = { type: 'Polygon', coordinates: [] };
        const { source } = geometry.loadAoi(ee, { authoritativeGeoJson: geo });
        expect(source).toBe('AUTHORITATIVE');
        // Should NOT have called Filter.eq (GAUL path skipped)
        expect(ee.calls.some((c) => c.name === 'Filter.eq')).toBe(false);
        expect(ee.calls.some((c) => c.name === 'Geometry')).toBe(true);
    });

    test('authoritative GeoJSON accepts a stringified JSON', () => {
        const ee = makeFakeEe();
        const { source } = geometry.loadAoi(ee, {
            authoritativeGeoJson: JSON.stringify({ type: 'Point', coordinates: [107.3, 21] }),
        });
        expect(source).toBe('AUTHORITATIVE');
    });

    test('AOI_SOURCE enum matches the migration CHECK constraint', () => {
        expect(geometry.AOI_SOURCE).toEqual({
            REFERENCE_GAUL: 'REFERENCE_GAUL',
            AUTHORITATIVE: 'AUTHORITATIVE',
        });
    });
});
