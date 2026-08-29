'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const {
    GeoTiffTimeSeriesError,
    INDEXER_PROPERTIES,
    TIME_REGEX_PROPERTIES,
    granuleFilename,
    assertCollectionLimits,
    assertCompatibleRasters,
    createZip,
    materializeImageMosaic,
} = require('../geotiff-time-series.service');

describe('geotiff-time-series.service', () => {
    test('generates canonical GeoServer extractor files and filenames', () => {
        expect(granuleFilename('urban_cover', '2024-01-01T00:00:00.000Z')).toBe(
            'urban_cover_20240101000000000Z.tif',
        );
        expect(INDEXER_PROPERTIES).toContain('TimeAttribute=ingestion');
        expect(TIME_REGEX_PROPERTIES).toBe("regex=[0-9]{17}Z,format=yyyyMMddHHmmssSSS'Z'\n");
    });

    test('rejects archive limits before any download', () => {
        expect(() =>
            assertCollectionLimits([{ id: 1, size_bytes: 11 }], {
                maxEntries: 2,
                maxEntryBytes: 100,
                maxExpandedBytes: 1000,
            }),
        ).toThrow(expect.objectContaining({ code: 'COLLECTION_ENTRY_LIMIT' }));
    });

    test('rejects incompatible band signatures but permits different grid sizes', () => {
        const base = {
            crs: 'EPSG:32648',
            bandCount: 1,
            width: 10,
            height: 10,
            bands: [{ type: 'Byte', noDataValue: 0, colorInterpretation: 'Gray' }],
        };
        expect(assertCompatibleRasters([base, { ...base, width: 20, height: 30 }])).toBe(base);
        expect(() =>
            assertCompatibleRasters([
                base,
                {
                    ...base,
                    bands: [{ type: 'UInt16', noDataValue: 0, colorInterpretation: 'Gray' }],
                },
            ]),
        ).toThrow(expect.objectContaining({ code: 'INCOMPATIBLE_RASTERS' }));
    });

    test('creates a readable ZIP without buffering source files', async () => {
        const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'campha-ts-zip-test-'));
        const tif = path.join(dir, 'granule.tif');
        const zip = path.join(dir, 'mosaic.zip');
        try {
            await fs.promises.writeFile(tif, Buffer.from('II*\0mock-tiff'));
            await createZip(zip, [{ path: tif, name: 'urban_cover_20240101000000000Z.tif' }]);
            const bytes = await fs.promises.readFile(zip);
            expect(bytes.subarray(0, 4)).toEqual(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
            expect(bytes.includes(Buffer.from('indexer.properties'))).toBe(true);
            expect(bytes.includes(Buffer.from('timeregex.properties'))).toBe(true);
        } finally {
            await fs.promises.rm(dir, { recursive: true, force: true });
        }
    });

    test('cleans the temporary workspace when inspection fails', async () => {
        const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'campha-ts-clean-test-'));
        const body = Buffer.from('II*\0mock-tiff');
        const member = {
            id: 7,
            size_bytes: body.length,
            acquired_at: '2024-01-01T00:00:00.000Z',
        };
        try {
            await expect(
                materializeImageMosaic(
                    { layerCode: 'urban_cover', members: [member] },
                    {
                        workDir: root,
                        limits: { maxEntries: 10, maxEntryBytes: 100, maxExpandedBytes: 1000 },
                        download: async (_member, target) => fs.promises.writeFile(target, body),
                        inspect: async () => {
                            throw new GeoTiffTimeSeriesError('GDAL_FAILED', 'GDAL failed');
                        },
                    },
                ),
            ).rejects.toMatchObject({ code: 'GDAL_FAILED' });
            expect(await fs.promises.readdir(root)).toEqual([]);
        } finally {
            await fs.promises.rm(root, { recursive: true, force: true });
        }
    });
});
