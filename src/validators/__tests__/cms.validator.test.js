'use strict';

const v = require('../cms.validator');

describe('CMS validators', () => {
    test('comment accepts plain text and rejects stored-XSS markup', () => {
        expect(
            v.commentCreateSchema.validate({ content: 'Nội dung hợp lệ' }).error,
        ).toBeUndefined();
        expect(
            v.commentCreateSchema.validate({ content: '<img src=x onerror=alert(1)>' }).error,
        ).toBeDefined();
    });
    test('pagination and presigned expiry are bounded', () => {
        expect(v.publicListSchema.validate({ limit: 101 }).error).toBeDefined();
        expect(v.downloadQuerySchema.validate({ expireSeconds: 901 }).error).toBeDefined();
        expect(v.downloadQuerySchema.validate({}).value.expireSeconds).toBe(300);
    });
    test('CMS list schemas allow only their supported sort fields', () => {
        expect(
            v.documentListSchema.validate({ sortBy: 'created_at', sortOrder: 'DESC' }).error,
        ).toBeUndefined();
        expect(v.documentListSchema.validate({ sortBy: 'year' }).error).toBeDefined();
        expect(
            v.pdfMapListSchema.validate({
                sortBy: 'year',
                sortOrder: 'ASC',
                yearFrom: 2020,
                yearTo: 2026,
                scaleLabel: '1:10.000',
            }).error,
        ).toBeUndefined();
        expect(v.pdfMapListSchema.validate({ sortBy: 'id' }).error).toBeUndefined();
        expect(v.pdfMapListSchema.validate({ sortBy: 'theme_code' }).error).toBeDefined();
    });
    test('news and PDF schemas enforce status and metadata', () => {
        expect(
            v.newsCreateSchema.validate({ title: 'Tin', content: 'Nội dung', status: 'bad' }).error,
        ).toBeDefined();
        expect(
            v.pdfMapCreateSchema.validate({
                title: 'Map',
                scaleLabel: '1:10.000',
                mapYear: 2026,
                preparingAgency: 'UBND',
                fileObjectId: 1,
            }).error,
        ).toBeUndefined();
    });
    test('document update requires a version and forbids replacing the file', () => {
        const expectedUpdatedAt = '2026-08-13T00:00:00.000Z';
        expect(
            v.documentUpdateSchema.validate({ expectedUpdatedAt, title: 'Tên mới' }).error,
        ).toBeUndefined();
        expect(v.documentUpdateSchema.validate({ title: 'Tên mới' }).error).toBeDefined();
        expect(v.documentUpdateSchema.validate({ expectedUpdatedAt }).error).toBeDefined();
        expect(
            v.documentUpdateSchema.validate({ expectedUpdatedAt, fileObjectId: 2 }).error,
        ).toBeDefined();
    });
});
