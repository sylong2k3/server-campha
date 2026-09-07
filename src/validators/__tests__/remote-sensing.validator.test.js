'use strict';
const v = require('../remote-sensing.validator');
describe('remote sensing validators', () => {
    test('accepts bounded catalog filters and rejects bad date range', () => {
        expect(
            v.listSchema.validate({
                platform: 'sentinel-2',
                from: '2026-01-01',
                to: '2026-02-01',
                limit: 100,
            }).error,
        ).toBeUndefined();
        expect(v.listSchema.validate({ from: '2026-02-01', to: '2026-01-01' }).error).toBeDefined();
        expect(v.listSchema.validate({ limit: 101 }).error).toBeDefined();
    });
    test('requires distinct comparison IDs and safe coverage key', () => {
        expect(v.compareSchema.validate({ beforeId: 1, afterId: 1 }).error).toBeDefined();
        expect(v.compareSchema.validate({ beforeId: 1, afterId: 2 }).error).toBeUndefined();
        expect(
            v.createSchema.validate({
                sceneCode: 'S1',
                title: 'Ảnh',
                platform: 'sentinel-2',
                coverageKey: 'bad/key',
                acquiredAt: '2026-01-01',
                fileObjectId: 1,
            }).error,
        ).toBeDefined();
    });
    test('validates bounded Web Map publish fields', () => {
        const valid = {
            code: 'lop_phu_sau_ngap_2024',
            nameVi: 'Lớp phủ sau ngập Cẩm Phả năm 2024',
            category: 'lop-phu-ngap',
            srid: 32648,
            minZoom: 8,
            maxZoom: 18,
            legendConfig: { type: 'rgb' },
            metadata: { resolutionM: 20 },
            isPublic: true,
        };
        expect(v.publishSchema.validate(valid).error).toBeUndefined();
        expect(v.publishSchema.validate({ ...valid, code: '../bad' }).error).toBeDefined();
        expect(
            v.publishSchema.validate({ ...valid, minZoom: 19, maxZoom: 18 }).error,
        ).toBeDefined();
        expect(v.publishSchema.validate({ ...valid, srid: 0 }).error).toBeDefined();
    });
    test('parses deleteFiles and defaults it to false', () => {
        const withDelete = v.deleteQuerySchema.validate({
            expectedUpdatedAt: '2026-08-12T10:00:00.000Z',
            deleteFiles: 'true',
        });
        expect(withDelete.error).toBeUndefined();
        expect(withDelete.value.deleteFiles).toBe(true);
        expect(
            v.deleteQuerySchema.validate({
                expectedUpdatedAt: '2026-08-12T10:00:00.000Z',
            }).value.deleteFiles,
        ).toBe(false);
    });
    test('validates admin list statuses and defaults to all', () => {
        expect(v.adminListSchema.validate({}).value.status).toBe('all');
        const allowedStatuses = [
            'all',
            'unpublished',
            'standalone',
            'time_series',
            'in_use',
            'cleanup_pending',
            'cleanup_failed',
        ];
        for (const status of allowedStatuses) {
            const res = v.adminListSchema.validate({ status });
            expect(res.error).toBeUndefined();
            expect(res.value.status).toBe(status);
        }
        expect(v.adminListSchema.validate({ status: 'active' }).error).toBeDefined();
        expect(v.adminListSchema.validate({ status: 'inactive' }).error).toBeDefined();
        expect(v.adminListSchema.validate({ status: 'invalid_status' }).error).toBeDefined();
    });
    test('validates updateCoverageKeySchema requirements', () => {
        expect(v.updateCoverageKeySchema.validate({ coverageKey: 'campha_2026' }).error).toBeUndefined();
        expect(v.updateCoverageKeySchema.validate({ coverageKey: 'c-1_a' }).error).toBeUndefined();
        expect(v.updateCoverageKeySchema.validate({ coverageKey: 'Bad/Key' }).error).toBeDefined();
        expect(v.updateCoverageKeySchema.validate({ coverageKey: '' }).error).toBeDefined();
        expect(v.updateCoverageKeySchema.validate({}).error).toBeDefined();
    });
});
