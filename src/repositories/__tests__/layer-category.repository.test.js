'use strict';

jest.mock('../../configs/database', () => ({
    query: jest.fn(),
}));

const db = require('../../configs/database');
const repository = require('../layer-category.repository');

describe('layer-category repository', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('list returns mapped category rows ordered by name_vi', async () => {
        db.query.mockResolvedValueOnce({
            rows: [
                {
                    id: 1,
                    key: 'giao_thong',
                    name_vi: 'Giao thông',
                    created_by: null,
                    created_at: new Date('2026-01-01'),
                    updated_at: new Date('2026-01-01'),
                },
                {
                    id: 2,
                    key: 'ngap_lut',
                    name_vi: 'Ngập lụt',
                    created_by: 10,
                    created_at: new Date('2026-01-02'),
                    updated_at: new Date('2026-01-02'),
                },
            ],
        });

        const result = await repository.list();
        expect(result).toEqual([
            {
                id: 1,
                key: 'giao_thong',
                name: 'Giao thông',
                createdAt: expect.any(Date),
                updatedAt: expect.any(Date),
            },
            {
                id: 2,
                key: 'ngap_lut',
                name: 'Ngập lụt',
                createdAt: expect.any(Date),
                updatedAt: expect.any(Date),
            },
        ]);
        expect(db.query).toHaveBeenCalledWith(
            expect.stringContaining('ORDER BY name_vi ASC, id ASC'),
        );
    });

    test('list filters by search param with ILIKE', async () => {
        db.query.mockResolvedValueOnce({
            rows: [
                {
                    id: 1,
                    key: 'giao_thong',
                    name_vi: 'Giao thông',
                    created_by: null,
                    created_at: new Date('2026-01-01'),
                    updated_at: new Date('2026-01-01'),
                },
            ],
        });

        const result = await repository.list({ search: 'giao' });
        expect(result).toHaveLength(1);
        expect(result[0].key).toBe('giao_thong');
        expect(db.query).toHaveBeenCalledWith(
            expect.stringContaining('WHERE name_vi ILIKE $1 OR key ILIKE $1'),
            ['%giao%'],
        );
    });

    test('findByKey filters by key', async () => {
        db.query.mockResolvedValueOnce({
            rows: [
                {
                    id: 3,
                    key: 'thuy_van',
                    name_vi: 'Thủy văn',
                    created_by: null,
                    created_at: new Date(),
                    updated_at: new Date(),
                },
            ],
        });

        const result = await repository.findByKey('thuy_van');
        expect(result).toMatchObject({
            id: 3,
            key: 'thuy_van',
            name: 'Thủy văn',
        });
        expect(db.query).toHaveBeenCalledWith(
            expect.stringContaining('WHERE key = $1'),
            ['thuy_van'],
        );
    });

    test('findByName compares case-insensitively with trimmed name', async () => {
        db.query.mockResolvedValueOnce({
            rows: [
                {
                    id: 4,
                    key: 'khu_cong_nghiep',
                    name_vi: 'Khu công nghiệp',
                    created_by: null,
                    created_at: new Date(),
                    updated_at: new Date(),
                },
            ],
        });

        const result = await repository.findByName('  Khu Công Nghiệp  ');
        expect(result).toMatchObject({
            id: 4,
            key: 'khu_cong_nghiep',
            name: 'Khu công nghiệp',
        });
        expect(db.query).toHaveBeenCalledWith(
            expect.stringContaining('LOWER(TRIM(name_vi)) = LOWER(TRIM($1))'),
            ['  Khu Công Nghiệp  '],
        );
    });

    test('create inserts new category and returns mapped row', async () => {
        db.query.mockResolvedValueOnce({
            rows: [
                {
                    id: 5,
                    key: 'quy_hoach_2030',
                    name_vi: 'Quy hoạch 2030',
                    created_by: 8,
                    created_at: new Date(),
                    updated_at: new Date(),
                },
            ],
        });

        const created = await repository.create({
            key: 'quy_hoach_2030',
            nameVi: 'Quy hoạch 2030',
            createdBy: 8,
        });

        expect(created).toMatchObject({
            id: 5,
            key: 'quy_hoach_2030',
            name: 'Quy hoạch 2030',
        });
        expect(db.query).toHaveBeenCalledWith(
            expect.stringContaining('INSERT INTO gis.layer_categories'),
            ['quy_hoach_2030', 'Quy hoạch 2030', 8],
        );
    });
});
