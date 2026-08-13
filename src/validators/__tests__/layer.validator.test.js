'use strict';

const validator = require('../layer.validator');

const validate = (schema, value) => schema.validate(value, { abortEarly: false, convert: true });
const base = {
    fileObjectId: 1,
    code: 'ward_boundary',
    nameVi: 'Ranh giới phường xã',
    category: 'ranh_gioi',
};

describe('layer validator', () => {
    test('accepts bounded Shapefile import contract', () => {
        const result = validate(validator.shapefileImportSchema, {
            ...base,
            sourceEncoding: 'UTF-8',
        });
        expect(result.error).toBeUndefined();
        expect(result.value).toMatchObject({
            targetSrid: 4326,
            topologyProfile: 'basic',
            isPublic: false,
        });
    });

    test('rejects unsafe generated layer code', () => {
        const result = validate(validator.shapefileImportSchema, {
            ...base,
            code: 'x;DROP TABLE layers',
        });
        expect(result.error).toBeTruthy();
    });

    test('Excel requires explicit sheet, distinct columns and source SRID', () => {
        const valid = validate(validator.excelImportSchema, {
            ...base,
            code: 'point_excel',
            sheetName: 'Sheet1',
            xColumn: 'longitude',
            yColumn: 'latitude',
            sourceSrid: 4326,
        });
        expect(valid.error).toBeUndefined();
        const same = validate(validator.excelImportSchema, {
            ...base,
            code: 'point_excel',
            sheetName: 'Sheet1',
            xColumn: 'coord',
            yColumn: 'coord',
            sourceSrid: 4326,
        });
        expect(same.error).toBeTruthy();
    });

    test('layer update requires expectedUpdatedAt and at least one field', () => {
        expect(validate(validator.layerUpdateSchema, { nameVi: 'A' }).error).toBeTruthy();
        expect(
            validate(validator.layerUpdateSchema, {
                expectedUpdatedAt: new Date().toISOString(),
                nameVi: 'Tên lớp mới',
            }).error,
        ).toBeUndefined();
    });

    test('layer update accepts the default-enabled setting', () => {
        expect(
            validate(validator.layerUpdateSchema, {
                expectedUpdatedAt: new Date().toISOString(),
                isEnableDefault: true,
            }).error,
        ).toBeUndefined();
    });

    test('layer update accepts a Vietnamese category display name', () => {
        expect(
            validate(validator.layerUpdateSchema, {
                expectedUpdatedAt: new Date().toISOString(),
                categoryName: 'Ranh giới hành chính',
            }).error,
        ).toBeUndefined();
    });

    test('ACL rejects duplicate role codes', () => {
        const item = {
            roleCode: 'citizen',
            canView: true,
            canExport: false,
            canEdit: false,
            canDelete: false,
        };
        expect(
            validate(validator.permissionsSchema, { permissions: [item, item] }).error,
        ).toBeTruthy();
    });
});
