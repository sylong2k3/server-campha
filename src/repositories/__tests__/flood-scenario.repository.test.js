'use strict';

jest.mock('../../configs/database', () => ({
    query: jest.fn(),
    getClient: jest.fn(),
}));

const db = require('../../configs/database');
const repo = require('../flood-scenario.repository');

describe('flood-scenario.repository', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('findMatchingScenario', () => {
        test('returns null immediately when rainfall is 0 without querying DB', async () => {
            const result = await repo.findMatchingScenario(0);
            expect(result).toBeNull();
            expect(db.query).not.toHaveBeenCalled();
        });

        test('returns null immediately when rainfall is 0.0 or negative or invalid', async () => {
            expect(await repo.findMatchingScenario('0.0')).toBeNull();
            expect(await repo.findMatchingScenario(-1)).toBeNull();
            expect(await repo.findMatchingScenario(NaN)).toBeNull();
            expect(db.query).not.toHaveBeenCalled();
        });

        test('queries DB and returns matching scenario when rainfall > 0', async () => {
            const mockRow = {
                id: 13,
                code: 'scenario_light_improved',
                name_vi: 'Kịch bản ngập nhẹ - sau cải tạo',
                min_rainfall: 29.1,
                max_rainfall: 48.14,
                min_tide: 0.0,
                max_tide: 0.84,
                layer_code: 'kich_ban_ngap_nhe_sau_cai_tao',
                description: '[[scenario:cai_tao]]',
                is_active: true,
            };
            db.query.mockResolvedValueOnce({ rows: [mockRow] });

            const result = await repo.findMatchingScenario(35.0, 0.5);
            expect(result).not.toBeNull();
            expect(result.id).toBe(13);
            expect(result.type).toBe('cai_tao');
            expect(db.query).toHaveBeenCalledTimes(1);
        });
    });

    describe('deactivateAllActive', () => {
        test('deactivates all active scenarios when no type filter is given', async () => {
            const mockRows = [
                { id: 13, code: 's1', is_active: false, description: '[[scenario:cai_tao]]' },
                { id: 14, code: 's2', is_active: false, description: '[[scenario:hien_trang]]' },
            ];
            db.query.mockResolvedValueOnce({ rows: mockRows });

            const result = await repo.deactivateAllActive();
            expect(result).toHaveLength(2);
            expect(db.query).toHaveBeenCalledTimes(1);
            const [sql] = db.query.mock.calls[0];
            expect(sql).toContain('UPDATE gis.flood_scenarios');
            expect(sql).toContain('SET is_active = false');
            expect(sql).toContain('WHERE is_active = true');
        });

        test('deactivates only specified types when types array is provided', async () => {
            const activeRows = [
                { id: 1, code: 's1', is_active: true, description: '[[scenario:hien_trang]]' },
                { id: 2, code: 's2', is_active: true, description: '[[scenario:cai_tao]]' },
            ];
            const updatedRows = [
                { id: 1, code: 's1', is_active: false, description: '[[scenario:hien_trang]]' },
            ];

            db.query
                .mockResolvedValueOnce({ rows: activeRows }) // SELECT active
                .mockResolvedValueOnce({ rows: updatedRows }); // UPDATE by IDs

            const result = await repo.deactivateAllActive({ types: ['hien_trang'] });
            expect(result).toHaveLength(1);
            expect(result[0].id).toBe(1);
            expect(db.query).toHaveBeenCalledTimes(2);
            const [selectSql] = db.query.mock.calls[0];
            expect(selectSql).toContain('SELECT');
            const [updateSql, params] = db.query.mock.calls[1];
            expect(updateSql).toContain('WHERE id = ANY($1::int[])');
            expect(params[0]).toEqual([1]);
        });
    });
});
