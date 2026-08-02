'use strict';

const validator = require('../web-map.validator');

describe('web map validators', () => {
    test('feature search defaults and bounds input', () => {
        expect(validator.featureSearchSchema.validate({ q: 'Cẩm Phả' }).value).toEqual({
            q: 'Cẩm Phả',
            limit: 20,
        });
        expect(validator.featureSearchSchema.validate({ q: 'x' }).error).toBeDefined();
        expect(
            validator.featureSearchSchema.validate({ q: 'cam pha', limit: 51 }).error,
        ).toBeDefined();
        expect(
            validator.featureSearchSchema.validate({ q: 'cam pha', bbox: '1,2,3' }).error,
        ).toBeDefined();
    });

    test('terrain URL expiry remains short-lived', () => {
        expect(validator.terrainUrlQuerySchema.validate({}).value.expireSeconds).toBe(300);
        expect(validator.terrainUrlQuerySchema.validate({ expireSeconds: 59 }).error).toBeDefined();
        expect(
            validator.terrainUrlQuerySchema.validate({ expireSeconds: 901 }).error,
        ).toBeDefined();
    });

    test('feature ID rejects SQL metacharacters', () => {
        expect(
            validator.featureParamsSchema.validate({ layerId: 1, featureId: 'abc_12' }).error,
        ).toBeUndefined();
        expect(
            validator.featureParamsSchema.validate({ layerId: 1, featureId: '1;DROP TABLE' }).error,
        ).toBeDefined();
    });
});
