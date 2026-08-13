'use strict';

const { processRequest } = require('../service');

const dates = { startDate: '2026-01-01', endDate: '2026-01-31' };

describe('satellite processing service', () => {
    test('persists product-specific statistics, legend, and metadata from the builder', async () => {
        const repository = {
            getByHash: jest.fn().mockResolvedValue(null),
            upsert: jest.fn().mockImplementation(async (value) => ({
                id: 'result-1',
                tile_url: value.tileUrl,
                stats: value.stats,
                legend: value.legend,
                metadata: value.metadata,
            })),
        };
        const gee = {
            ensureInitialized: jest.fn().mockResolvedValue(),
            evaluate: jest.fn(),
            getMapId: jest.fn().mockResolvedValue({ mapId: 'map-1', tileUrl: 'https://tiles/{z}/{x}/{y}' }),
            getDownloadUrl: jest.fn().mockResolvedValue('https://download/image.tif'),
        };
        const region = { id: 'cp-rg-polygon' };
        const clippedImage = { id: 'image-clipped' };
        const image = { id: 'image', clip: jest.fn().mockReturnValue(clippedImage) };
        const buildImage = jest.fn().mockResolvedValue({
            image,
            viz: { min: -0.2, max: 0.8 },
            region,
            stats: { imageCount: 4, vegetationHa: 27.5, ndviThreshUsed: 0.3 },
            legend: [{ value: 0.3, label: 'Vegetation' }],
            metadata: { source: ['L8', 'L9', 'S2'], downloadScaleMeters: 1000 },
        });

        const result = await processRequest('ndvi', dates, { repository, gee, buildImage });

        expect(gee.ensureInitialized).toHaveBeenCalledTimes(1);
        expect(repository.upsert).toHaveBeenCalledWith(
            expect.objectContaining({
                stats: { imageCount: 4, vegetationHa: 27.5, ndviThreshUsed: 0.3 },
                legend: [{ value: 0.3, label: 'Vegetation' }],
                metadata: expect.objectContaining({
                    source: ['L8', 'L9', 'S2'],
                    productVersion: 'optical-rg-clip-v3',
                    downloadClip: { geometrySource: 'cp_rg.geojson', method: 'polygon-mask' },
                }),
            }),
        );
        expect(image.clip).toHaveBeenCalledWith(region);
        expect(gee.getMapId).toHaveBeenCalledWith(clippedImage, { min: -0.2, max: 0.8 });
        expect(gee.getDownloadUrl).toHaveBeenCalledWith(
            clippedImage,
            expect.objectContaining({ region, scale: 1000 }),
        );
        expect(result.stats.vegetationHa).toBe(27.5);
    });
});
