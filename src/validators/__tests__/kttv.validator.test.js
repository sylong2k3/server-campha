'use strict';

const v = require('../kttv.validator');

const mapping = {
    observedAtPath: 'current.time',
    stationCode: 'CP-WEATHER',
    mappings: [{ path: 'current.rain', variable: 'rain_1h_mm', unit: 'mm' }],
};
const source = (extra = {}) => ({
    name: 'Weather API',
    serviceType: 'REST',
    endpointUrl: 'https://api.example.test/weather',
    ...extra,
});

describe('kttv validator — nguồn REST/JSON', () => {
    test('nguồn bật/lập lịch phải có JSON mapping đầy đủ', () => {
        expect(
            v.sourceCreateSchema.validate(
                source({ responseFormat: 'JSON', variables: mapping, isEnabled: true }),
            ).error,
        ).toBeUndefined();
        expect(v.sourceCreateSchema.validate(source({ isEnabled: true })).error).toBeDefined();
        expect(
            v.sourceCreateSchema.validate(
                source({ responseFormat: 'GeoJSON', variables: mapping, cronExpr: '*/5 * * * *' }),
            ).error,
        ).toBeDefined();
    });

    test('chỉ nhận auth method đã triển khai và credential tương ứng', () => {
        expect(
            v.sourceCreateSchema.validate(
                source({ authMethod: 'bearer', credential: { token: 'secret' } }),
            ).error,
        ).toBeUndefined();
        expect(
            v.sourceCreateSchema.validate(
                source({ authMethod: 'bearer', credential: { apiKey: 'wrong-kind' } }),
            ).error,
        ).toBeDefined();
        expect(
            v.sourceCreateSchema.validate(
                source({ authMethod: 'query_key', credential: { apiKey: 'secret' } }),
            ).error,
        ).toBeDefined();
        expect(
            v.sourceCreateSchema.validate(source({ credential: { token: 'orphan' } })).error,
        ).toBeDefined();
    });
});

describe('kttv validator — scenario và input chuẩn', () => {
    test('chặn khoảng hiệu lực đảo chiều ở create và patch', () => {
        const dates = {
            effectiveFrom: '2026-08-08T00:00:00Z',
            effectiveTo: '2026-08-07T00:00:00Z',
        };
        expect(
            v.scenarioCreateSchema.validate({
                code: 'MUA_LON',
                name: 'Mưa lớn',
                matchRule: {
                    all: [{ variable: 'rain_1h_mm', unit: 'mm', op: 'gte', value: 30 }],
                },
                ...dates,
            }).error,
        ).toBeDefined();
        expect(
            v.scenarioUpdateSchema.validate({
                ...dates,
                expectedUpdatedAt: '2026-08-06T00:00:00Z',
            }).error,
        ).toBeDefined();
    });

    test('between phải tăng dần; input không nhận Infinity', () => {
        expect(
            v.matchRule.validate({
                all: [{ variable: 'rain_1h_mm', unit: 'mm', op: 'between', value: [50, 30] }],
            }).error,
        ).toBeDefined();
        expect(
            v.manualInputSchema.validate({
                stationCode: 'CP-WEATHER',
                observedAt: '2026-08-08T00:00:00Z',
                values: { rain_1h_mm: { value: Infinity, unit: 'mm' } },
            }).error,
        ).toBeDefined();
    });
});
