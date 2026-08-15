'use strict';

jest.mock('../../configs/database', () => ({
    query: jest.fn(),
    pool: { connect: jest.fn() },
}));

const db = require('../../configs/database');
const repository = require('../forest-classification.repository');

describe('forest-classification.repository listRuns', () => {
    beforeEach(() => jest.clearAllMocks());

    test('returns only the newest attempt of each period before pagination', async () => {
        db.query.mockResolvedValue({
            rows: [
                { id: 11, year: 2026, month: 7, attempt: 4, total_count: 2 },
                { id: 9, year: 2026, month: 1, attempt: 6, total_count: 2 },
            ],
        });

        await expect(repository.listRuns({ page: 2, limit: 10 })).resolves.toEqual({
            items: [
                { id: 11, year: 2026, month: 7, attempt: 4 },
                { id: 9, year: 2026, month: 1, attempt: 6 },
            ],
            total: 2,
        });

        const [sql, params] = db.query.mock.calls[0];
        expect(sql).toMatch(/DISTINCT ON \(s\.year, s\.month\)/);
        expect(sql).toMatch(/s\.attempt DESC, s\.id DESC/);
        expect(sql).toMatch(/COUNT\(\*\) OVER\(\)::int AS total_count/);
        expect(params).toEqual([10, 10]);
    });

    test('applies the published filter before choosing the latest published attempt', async () => {
        db.query.mockResolvedValue({ rows: [] });

        await repository.listRuns({ publishedOnly: true });

        expect(db.query.mock.calls[0][0]).toMatch(
            /WHERE status = 'published' OR geoserver_layer IS NOT NULL/,
        );
    });

    test('finds the latest successful raster candidate in a period', async () => {
        db.query.mockResolvedValue({
            rows: [{ id: 12, year: 2026, month: 7, attempt: 5, status: 'exporting' }],
        });

        await expect(repository.getLatestSuccessfulByPeriod(2026, 7)).resolves.toEqual(
            expect.objectContaining({ id: 12, attempt: 5 }),
        );

        const [sql, params] = db.query.mock.calls[0];
        expect(sql).toMatch(/gee_download_url IS NOT NULL/);
        expect(sql).toMatch(/status IN \('exporting', 'completed', 'published'\)/);
        expect(sql).toMatch(/ORDER BY attempt DESC, id DESC/);
        expect(params).toEqual([2026, 7]);
    });

    test('lists live snapshots for startup recovery', async () => {
        db.query.mockResolvedValue({
            rows: [{ id: 13, status: 'exporting' }],
        });

        await expect(repository.listActiveRuns()).resolves.toEqual([
            { id: 13, status: 'exporting' },
        ]);

        const [sql] = db.query.mock.calls[0];
        expect(sql).toMatch(/status IN \('pending', 'computing', 'exporting'\)/);
        expect(sql).toMatch(/ORDER BY id ASC/);
    });
});
