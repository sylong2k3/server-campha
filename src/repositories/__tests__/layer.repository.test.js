'use strict';

jest.mock('../../configs/database', () => ({
    query: jest.fn(),
    getClient: jest.fn(),
}));
jest.mock('../../repositories/file-cleanup.repository', () => ({}));

const db = require('../../configs/database');
const repository = require('../layer.repository');

const derivedLayer = {
    id: 9,
    code: 'forest_classification_202501',
    storage_kind: 'geotiff_minio',
    object_key: 'raster/2025/01/forest/latest.tif',
    source_file_id: null,
    metadata: {
        rasterIngestJobId: 41,
        geoserverPublishCategory: 'raster',
    },
};

describe('layer ACL admin invariant', () => {
    test.each([false, true])(
        'replacement preserves admin even with explicit deny=%s',
        async (denyAdmin) => {
            const citizenAcl = {
                roleCode: 'citizen',
                canView: true,
                canExport: false,
                canEdit: false,
                canDelete: false,
            };
            const permissions = [citizenAcl];
            if (denyAdmin) {
                permissions.push({
                    roleCode: 'system_admin',
                    canView: false,
                    canExport: false,
                    canEdit: false,
                    canDelete: false,
                });
            }
            const client = {
                query: jest.fn(async (sql) => {
                    if (sql.startsWith('SELECT id')) {
                        return { rowCount: 1 };
                    }
                    if (sql.startsWith('UPDATE gis.layers')) {
                        return { rows: [{ updated_at: '2026-09-27', version: 2 }] };
                    }
                    if (sql.includes('SELECT l.*')) {
                        return { rows: [{ id: 9 }] };
                    }
                    return { rows: [] };
                }),
                release: jest.fn(),
            };
            db.getClient.mockResolvedValue(client);
            await repository.replacePermissions(9, permissions);
            const inserts = client.query.mock.calls.filter(([sql]) =>
                sql.includes('INSERT INTO gis.layer_permissions'),
            );
            expect(inserts.map(([, params]) => params)).toEqual([
                [9, 'citizen', true, false, false, false],
                [9, 'system_admin', true, true, true, true],
            ]);
            expect(client.query).toHaveBeenLastCalledWith('COMMIT');
            expect(permissions).toHaveLength(denyAdmin ? 2 : 1);
        },
    );
});

describe('layer repository raster artifact lookup', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('returns mirror metadata only after matching ingest job, layer code and object key', async () => {
        db.query.mockResolvedValueOnce({ rows: [{ id: 41 }] });

        await expect(repository.findRasterIngestArtifact(derivedLayer)).resolves.toEqual({
            geoserverPublishCategory: 'raster',
        });
        expect(db.query).toHaveBeenCalledWith(
            expect.stringContaining('layer_id = $2 AND layer_code = $3 AND minio_key = $4'),
            [41, 9, 'forest_classification_202501', 'raster/2025/01/forest/latest.tif'],
        );
    });

    test('rejects a source-file raster without querying ingest jobs', async () => {
        await expect(
            repository.findRasterIngestArtifact({ ...derivedLayer, source_file_id: 32 }),
        ).resolves.toBeNull();
        expect(db.query).not.toHaveBeenCalled();
    });

    test('rejects nonmatching job data', async () => {
        db.query.mockResolvedValueOnce({ rows: [] });

        await expect(repository.findRasterIngestArtifact(derivedLayer)).resolves.toBeNull();
    });

    test('uses guarded raster fallback for legacy valid ingest rows', async () => {
        db.query.mockResolvedValueOnce({ rows: [{ id: 41 }] });

        await expect(
            repository.findRasterIngestArtifact({
                ...derivedLayer,
                metadata: { rasterIngestJobId: 41 },
            }),
        ).resolves.toEqual({ geoserverPublishCategory: 'raster' });
    });
});

describe('layer repository list query', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('builds query with category filter matching category key or category_name', async () => {
        db.query.mockResolvedValueOnce({
            rows: [{ id: 1, name_vi: 'Ảnh viễn thám 2025', total_count: 1 }],
        });

        const result = await repository.list({
            page: 1,
            limit: 50,
            sortBy: 'created_at',
            sortOrder: 'DESC',
            category: 'remote_sensing',
        });

        expect(result.total).toBe(1);
        expect(result.items).toHaveLength(1);
        expect(db.query).toHaveBeenCalledWith(
            expect.stringContaining(
                '(LOWER(TRIM(l.category)) = LOWER(TRIM($1)) OR LOWER(TRIM(COALESCE(l.category_name, \'\'))) = LOWER(TRIM($1)))',
            ),
            ['remote_sensing', 50, 0],
        );
    });

    test('ignores category when category is "all"', async () => {
        db.query.mockResolvedValueOnce({ rows: [] });

        await repository.list({
            page: 1,
            limit: 10,
            category: 'all',
        });

        expect(db.query).toHaveBeenCalledWith(
            expect.not.stringContaining('l.category'),
            [10, 0],
        );
    });
});
