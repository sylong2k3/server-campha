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

    test('accepts Vietnamese encodings TCVN3 and WINDOWS-1258', () => {
        for (const enc of ['TCVN3', 'tcvn3', 'WINDOWS-1258', 'CP1258']) {
            const res = validate(validator.shapefileImportSchema, {
                ...base,
                sourceEncoding: enc,
            });
            expect(res.error).toBeUndefined();
            expect(res.value.sourceEncoding).toBe(enc.toUpperCase());
        }
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

    test('layer update accepts a valid legend entries payload', () => {
        const result = validate(validator.layerUpdateSchema, {
            expectedUpdatedAt: new Date().toISOString(),
            legendConfig: {
                entries: [
                    { label: 'Mặt nước', color: '#1A73E8' },
                    { label: 'Rừng', color: '#2D7B2E' },
                ],
            },
        });
        expect(result.error).toBeUndefined();
        expect(result.value.legendConfig.entries).toHaveLength(2);
    });

    test('layer update allows clearing legend with null', () => {
        expect(
            validate(validator.layerUpdateSchema, {
                expectedUpdatedAt: new Date().toISOString(),
                legendConfig: null,
            }).error,
        ).toBeUndefined();
    });

    test('layer update rejects legacy legend shapes without entries', () => {
        expect(
            validate(validator.layerUpdateSchema, {
                expectedUpdatedAt: new Date().toISOString(),
                legendConfig: { type: 'rgb', bands: ['red', 'green', 'blue'] },
            }).error,
        ).toBeTruthy();
    });

    test('layer update rejects legend entries with invalid hex color', () => {
        expect(
            validate(validator.layerUpdateSchema, {
                expectedUpdatedAt: new Date().toISOString(),
                legendConfig: { entries: [{ label: 'Rừng', color: 'green' }] },
            }).error,
        ).toBeTruthy();
    });
});

