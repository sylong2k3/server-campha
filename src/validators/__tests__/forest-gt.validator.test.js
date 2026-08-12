'use strict';

const schemas = require('../forest-gt.validator');

describe('forest ground-truth validation', () => {
    test('accepts a Cẩm Phả field point and class endpoints 0..12', () => {
        for (const candidate of [0, 12]) {
            const { error } = schemas.pointCreate.validate({
                observedAt: '2026-08-01T00:00:00.000Z',
                classId: candidate,
                lng: 107.3,
                lat: 21.05,
            });
            expect(error).toBeUndefined();
        }
    });

    test('rejects points outside the operational AOI guardrail', () => {
        const { error } = schemas.pointCreate.validate({
            observedAt: '2026-08-01T00:00:00.000Z',
            classId: 4,
            lng: 100,
            lat: 10,
        });
        expect(error).toBeDefined();
    });

    test('rejects a bulk polygon feature without a valid forest class', () => {
        const { error } = schemas.featureCollection.validate({
            type: 'FeatureCollection',
            features: [{
                type: 'Feature',
                properties: { class_id: 99 },
                geometry: {
                    type: 'Polygon',
                    coordinates: [[
                        [107.2, 21.0], [107.3, 21.0], [107.3, 21.1],
                        [107.2, 21.1], [107.2, 21.0],
                    ]],
                },
            }],
        });
        expect(error).toBeDefined();
    });
});
