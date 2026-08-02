'use strict';
const Joi = require('joi');
const registry = require('../api-registry.validator'),
    shared = require('../shared-layer.validator');
describe('Sprint 13 validators', () => {
    test('write key scopes and strict field names', () => {
        expect(
            registry.keyBody.validate({
                name: 'Integration',
                consumer: 'Portal',
                scopes: ['features:read', 'features:update'],
                quotaPerMinute: 60,
                expiresInHours: 24,
            }).error,
        ).toBeUndefined();
        expect(
            registry.registryBody.validate({
                layerId: 1,
                slug: 'roads-api',
                name: 'Roads',
                readFields: ['name'],
                writeFields: ['name;DROP'],
                searchFields: [],
                allowedMethods: ['GET'],
                defaultSortField: 'name',
            }).error,
        ).toBeInstanceOf(Joi.ValidationError);
    });
    test('bounds Cẩm Phả GeoJSON and closes polygon rings', () => {
        const base = { featureId: 'ext-1', attributes: { name: 'A' } };
        expect(
            shared.create.validate({
                ...base,
                geometry: { type: 'Point', coordinates: [107.3, 21.0] },
            }).error,
        ).toBeUndefined();
        expect(
            shared.create.validate({ ...base, geometry: { type: 'Point', coordinates: [10, 10] } })
                .error,
        ).toBeInstanceOf(Joi.ValidationError);
        expect(
            shared.create.validate({
                ...base,
                geometry: {
                    type: 'Polygon',
                    coordinates: [
                        [
                            [107.3, 21],
                            [107.4, 21],
                            [107.4, 21.1],
                            [107.3, 21.1],
                        ],
                    ],
                },
            }).error,
        ).toBeInstanceOf(Joi.ValidationError);
    });
});
