'use strict';
const v = require('../field-report.validator');
describe('Sprint 8 field report validator', () => {
    test('accepts bounded Cẩm Phả report', () => {
        expect(
            v.createSchema.validate({
                description: 'Phản ánh lấn chiếm khu vực này',
                longitude: 107.33,
                latitude: 21.01,
                photoIds: [1],
            }).error,
        ).toBeUndefined();
    });
    test('rejects HTML, invalid WGS84 coordinates and duplicate photos', () => {
        expect(
            v.createSchema.validate({
                description: '<b>bad content</b>',
                longitude: 107.33,
                latitude: 21.01,
            }).error,
        ).toBeDefined();
        expect(
            v.createSchema.validate({
                description: 'Nội dung phản ánh hợp lệ',
                longitude: 1,
                latitude: 1,
            }).error,
        ).toBeUndefined();
        expect(
            v.createSchema.validate({
                description: 'Nội dung phản ánh hợp lệ',
                longitude: 200,
                latitude: 95,
            }).error,
        ).toBeDefined();
        expect(
            v.createSchema.validate({
                description: 'Nội dung phản ánh hợp lệ',
                longitude: 107.3,
                latitude: 21,
                photoIds: [1, 1],
            }).error,
        ).toBeDefined();
        expect(
            v.createSchema.validate({
                description: 'Nội dung phản ánh hợp lệ',
                longitude: 107.3,
                latitude: 21,
                measuredGeometry: {
                    type: 'LineString',
                    coordinates: [
                        [107.3, 21],
                        [200, 95],
                    ],
                },
            }).error,
        ).toBeDefined();
    });
    test('requires reject reason and caps time window', () => {
        expect(
            v.reviewSchema.validate({
                status: 'rejected',
                expectedUpdatedAt: new Date().toISOString(),
            }).error,
        ).toBeDefined();
        expect(
            v.nearbySchema.validate({
                longitude: 107.3,
                latitude: 21,
                radiusMeters: 100,
                from: '2024-01-01',
                to: '2026-01-01',
            }).error,
        ).toBeDefined();
    });
});
