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
