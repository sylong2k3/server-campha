'use strict';
const v = require('../mobile-gis.validator');
describe('mobile GIS validator', () => {
    test('accepts bounded tile, line measurement and shortest route', () => {
        expect(
            v.tileParams.validate({ layerId: 1, z: 12, x: 3267, y: '1820.mvt' }).error,
        ).toBeUndefined();
        expect(
            v.measureBody.validate({
                geometry: {
                    type: 'LineString',
                    coordinates: [
                        [107.3, 21],
                        [107.31, 21.01],
                    ],
                },
            }).error,
        ).toBeUndefined();
        expect(
            v.routeBody.validate({
                start: [107.3, 21],
                end: [107.31, 21.01],
                profile: 'walking',
            }).error,
        ).toBeUndefined();
        expect(
            v.routeBody.validate(
                { layerId: 1, start: [107.3, 21], end: [107.31, 21.01] },
                { allowUnknown: false },
            ).error,
        ).toBeDefined();
    });
    test('rejects tile outside zoom grid, point measurement, open polygon and oversized radius', () => {
        expect(v.tileParams.validate({ layerId: 1, z: 0, x: 1, y: '0.mvt' }).error).toBeDefined();
        expect(
            v.measureBody.validate({ geometry: { type: 'Point', coordinates: [107.3, 21] } }).error,
        ).toBeDefined();
        expect(
            v.measureBody.validate({
                geometry: {
                    type: 'Polygon',
                    coordinates: [
                        [
                            [107.3, 21],
                            [107.31, 21],
                            [107.31, 21.01],
                            [107.3, 21.01],
                        ],
                    ],
                },
            }).error,
        ).toBeDefined();
        expect(
            v.draftBody.validate({ title: 'x', geometry: { type: 'Point', coordinates: [1, 1] } })
                .error,
        ).toBeDefined();
        expect(
            v.nearbyQuery.validate({ longitude: 107.3, latitude: 21, radiusMeters: 2001 }).error,
        ).toBeDefined();
    });
    test('bounds source edits and offline batches', () => {
        expect(
            v.featureChange.validate({ baseVersion: 1, attributes: { name: 'valid' } }).error,
        ).toBeUndefined();
        expect(
            v.featureChange.validate({ baseVersion: 1, attributes: { nested: { bad: true } } })
                .error,
        ).toBeDefined();
        expect(
            v.syncBody.validate({
                clientId: '785d9ba2-4d51-4d3a-b8af-28d285dc36d2',
                changes: [
                    {
                        clientChangeId: '8fd3461c-8a73-423b-8cca-e513696bba25',
                        layerId: 1,
                        featureId: '1',
                        baseVersion: 1,
                        attributes: { name: 'x' },
                    },
                ],
            }).error,
        ).toBeUndefined();
        expect(v.syncBody.validate({ clientId: 'bad', changes: [] }).error).toBeDefined();
    });
});
