'use strict';

jest.mock('../../../configs/raster-ingest', () => ({
    isEnabled: jest.fn(() => true),
}));

const { buildPeriodLayerCode, queueSnapshotArchive } = require('../archive');

describe('forest classification archive', () => {
    test('uses one canonical layer and MinIO object per period', async () => {
        const rasterIngest = {
            enqueue: jest.fn().mockResolvedValue({ job: { id: 41 }, deduplicated: false }),
        };

        const result = await queueSnapshotArchive(
            { id: 12, year: 2026, month: 7 },
            { downloadUrl: 'https://example.test/result.tif' },
            { rasterIngest },
        );

        expect(buildPeriodLayerCode(2026, 7)).toBe('forest_classification_202607');
        expect(rasterIngest.enqueue).toHaveBeenCalledWith(
            expect.objectContaining({
                layerCode: 'forest_classification_202607',
                requestParams: expect.objectContaining({
                    objectKeyTag: 'latest',
                    objectKeyYear: 2026,
                    objectKeyMonth: 7,
                    linkedResource: { type: 'forest_snapshot', id: 12 },
                }),
            }),
        );
        expect(result.layerCode).toBe('forest_classification_202607');
    });
});
