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
});
