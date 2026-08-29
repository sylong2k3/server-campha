'use strict';

const controller = require('../admin-dashboard.controller');
const db = require('../../configs/database');
const forestRepo = require('../../repositories/forest-classification.repository');

jest.mock('../../configs/database', () => ({
    query: jest.fn(),
}));

jest.mock('../../repositories/forest-classification.repository', () => ({
    getLatestCompleted: jest.fn(),
}));

describe('adminDashboard.controller.overview', () => {
    let req;
    let res;

    beforeEach(() => {
        jest.clearAllMocks();
        req = {
            user: {
                id: 1,
                role: 'system_admin',
                role_permissions: {
                    flood: { read: true },
                    forest_classification: { read: true },
                    field_report: { read: true },
                    layers: { read: true },
                },
            },
        };
        res = {
            status: jest.fn().mockReturnThis(),
            json: jest.fn(),
        };
    });

    it('returns full real metrics when user has all read permissions', async () => {
        db.query.mockImplementation((sql) => {
            if (sql.includes('gis.flood_analysis_runs')) {
                return Promise.resolve({
                    rows: [
                        {
                            id: 55,
                            module: 'trend',
                            status: 'SUCCEEDED',
                            params_snapshot: { monitorStart: '2026-08-01', monitorEnd: '2026-08-15' },
                            result_metadata: { areaStats: { floodExtentAreaHa: 450.2 } },
                            finished_at: '2026-08-16T00:00:00Z',
                        },
                    ],
                });
            }
            if (sql.includes('community.field_reports')) {
                return Promise.resolve({
                    rows: [
                        { status: 'pending', cnt: 3 },
                        { status: 'under_review', cnt: 2 },
                        { status: 'resolved', cnt: 10 },
                    ],
                });
            }
            if (sql.includes('gis.layers')) {
                return Promise.resolve({
                    rows: [
                        { total: 30, published: 25, public_count: 8, latest_updated_at: '2026-08-20T00:00:00Z' },
                    ],
                });
            }
            return Promise.resolve({ rows: [] });
        });

        forestRepo.getLatestCompleted.mockResolvedValue({
            id: 10,
            year: 2026,
            month: 4,
            status: 'COMPLETED',
            province_summary: {
                totalHa: 10000,
                forestHa: 6500,
                mineHa: 2000,
                forestPercent: 65,
                minePercent: 20,
            },
            computed_at: '2026-04-30T00:00:00Z',
        });

        await controller.overview(req, res);

        expect(res.status).toHaveBeenCalledWith(200);
        const payload = res.json.mock.calls[0][0];
        expect(payload.status).toBe(200);
        expect(payload.data.flood).toMatchObject({
            runId: 55,
            status: 'SUCCEEDED',
            floodExtentAreaHa: 450.2,
        });
        expect(payload.data.classification).toMatchObject({
            snapshotId: 10,
            year: 2026,
            month: 4,
        });
        expect(payload.data.landComposition).toMatchObject({
            forestPercent: 65,
            minePercent: 20,
        });
        expect(payload.data.feedback).toMatchObject({
            total: 15,
            byStatus: { pending: 3, under_review: 2, resolved: 10 },
        });
        expect(payload.data.layers).toMatchObject({
            total: 30,
            published: 25,
            publicCount: 8,
        });
        expect(typeof payload.data.generatedAt).toBe('string');
    });

    it('omits unauthorized blocks when user lacks corresponding permissions', async () => {
        req.user.role_permissions = {
            layers: { read: true },
        };

        db.query.mockImplementation((sql) => {
            if (sql.includes('gis.layers')) {
                return Promise.resolve({
                    rows: [{ total: 5, published: 5, public_count: 2, latest_updated_at: null }],
                });
            }
            return Promise.resolve({ rows: [] });
        });

        await controller.overview(req, res);

        expect(forestRepo.getLatestCompleted).not.toHaveBeenCalled();
        const payload = res.json.mock.calls[0][0];
        expect(payload.data.flood).toBeNull();
        expect(payload.data.classification).toBeNull();
        expect(payload.data.landComposition).toBeNull();
        expect(payload.data.feedback).toBeNull();
        expect(payload.data.layers).toMatchObject({ total: 5, published: 5 });
    });
});
