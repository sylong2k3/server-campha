'use strict';

const { evaluateRule, matchScenarios } = require('../kttv-matcher.util');

const values = {
    rain_1h_mm: { value: 35, unit: 'mm' },
    water_level_m: { value: 2.4, unit: 'm' },
};
const scenario = (id, priority, rule, extra = {}) => ({
    id,
    match_priority: priority,
    match_rule: rule,
    effective_from: null,
    effective_to: null,
    ...extra,
});

describe('kttv matcher DSL', () => {
    test('hỗ trợ all/any, between và chặn sai đơn vị/thiếu biến', () => {
        expect(
            evaluateRule(
                {
                    all: [
                        { variable: 'rain_1h_mm', unit: 'mm', op: 'between', value: [30, 40] },
                        { variable: 'water_level_m', unit: 'm', op: 'gte', value: 2 },
                    ],
                },
                values,
            ),
        ).toBe(true);
        expect(
            evaluateRule(
                {
                    any: [
                        { variable: 'wind_ms', unit: 'm/s', op: 'gt', value: 10 },
                        { variable: 'water_level_m', unit: 'm', op: 'gte', value: 2 },
                    ],
                },
                values,
            ),
        ).toBe(true);
        expect(
            evaluateRule(
                { all: [{ variable: 'rain_1h_mm', unit: 'cm', op: 'gte', value: 3 }] },
                values,
            ),
        ).toBe(false);
    });

    test('chọn priority nhỏ nhất', () => {
        const rule = { all: [{ variable: 'rain_1h_mm', unit: 'mm', op: 'gte', value: 30 }] };
        expect(
            matchScenarios([scenario(1, 100, rule), scenario(2, 10, rule)], values, new Date()),
        ).toEqual({
            status: 'matched',
            scenarioId: 2,
            candidateScenarioIds: [2],
        });
    });

    test('trả no_match, ambiguous và bỏ kịch bản ngoài hiệu lực', () => {
        const miss = { all: [{ variable: 'rain_1h_mm', unit: 'mm', op: 'gt', value: 100 }] };
        expect(matchScenarios([scenario(1, 1, miss)], values, new Date()).status).toBe('no_match');

        const hit = { all: [{ variable: 'rain_1h_mm', unit: 'mm', op: 'gte', value: 30 }] };
        expect(
            matchScenarios([scenario(1, 10, hit), scenario(2, 10, hit)], values, new Date()),
        ).toEqual({
            status: 'ambiguous',
            scenarioId: null,
            candidateScenarioIds: [1, 2],
        });
        expect(
            matchScenarios(
                [scenario(3, 1, hit, { effective_to: '2020-01-01T00:00:00Z' })],
                values,
                new Date(),
            ).status,
        ).toBe('no_match');
    });
});
