'use strict';
const validator = require('../spatial-statistics.validator');
describe('Sprint 7 statistics validator', () => {
    test('accepts dated polygon source', () => {
        expect(
            validator.createSourceSchema.validate({
                layerId: 1,
                sourceType: 'flood',
                observedYear: 2026,
                geometryColumn: 'geom',
            }).error,
        ).toBeUndefined();
    });
    test('requires boundary columns and a time for non-boundary source', () => {
        expect(
            validator.createSourceSchema.validate({
                layerId: 1,
                sourceType: 'administrative_boundary',
                geometryColumn: 'geom',
            }).error,
        ).toBeDefined();
        expect(
            validator.createSourceSchema.validate({
                layerId: 1,
                sourceType: 'flood',
                geometryColumn: 'geom',
            }).error,
        ).toBeDefined();
    });
    test('rejects unsafe identifiers and mismatched compare', () => {
        expect(
            validator.createSourceSchema.validate({
                layerId: 1,
                sourceType: 'flood',
                observedYear: 2026,
                geometryColumn: 'geom;drop table',
            }).error,
        ).toBeDefined();
        expect(
            validator.compareSchema.validate({ beforeSourceId: 1, afterSourceId: 1 }).error,
        ).toBeDefined();
    });
});
