'use strict';
const v = require('../remote-sensing.validator');
describe('remote sensing validators', () => {
    test('accepts bounded catalog filters and rejects bad date range', () => {
        expect(v.listSchema.validate({ platform: 'sentinel-2', from: '2026-01-01', to: '2026-02-01', limit: 100 }).error).toBeUndefined();
        expect(v.listSchema.validate({ from: '2026-02-01', to: '2026-01-01' }).error).toBeDefined();
        expect(v.listSchema.validate({ limit: 101 }).error).toBeDefined();
    });
    test('requires distinct comparison IDs and safe coverage key', () => {
        expect(v.compareSchema.validate({ beforeId: 1, afterId: 1 }).error).toBeDefined();
        expect(v.compareSchema.validate({ beforeId: 1, afterId: 2 }).error).toBeUndefined();
        expect(v.createSchema.validate({ sceneCode:'S1',title:'Ảnh',platform:'sentinel-2',coverageKey:'bad/key',acquiredAt:'2026-01-01',fileObjectId:1 }).error).toBeDefined();
    });
});