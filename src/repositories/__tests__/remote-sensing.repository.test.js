'use strict';

jest.mock('../../configs/database', () => {
    const client = { query: jest.fn(), release: jest.fn() };
    return {
        query: jest.fn(),
        getClient: jest.fn(() => Promise.resolve(client)),
        __client: client,
    };
});

const db = require('../../configs/database');
const { query, release } = db.__client;
const repository = require('../remote-sensing.repository');

const input = {
    code: 'lop_phu_truoc_ngap_2015',
    nameVi: 'Lớp phủ trước ngập Cẩm Phả năm 2015',
    category: 'lop-phu-ngap',
    srid: 32648,
    minZoom: 8,
    maxZoom: 18,
    legendConfig: { type: 'rgb' },
    metadata: { year: 2015 },
    isPublic: true,
};
const image = {
    id: 12,
    scene_code: 'CAM-PHA-LAND-COVER-TRUOC-NGAP-2015',
    acquired_at: '2015-01-01T00:00:00.000Z',
    platform: 'sentinel-2',
    resolution_m: '10.00',
    file_object_id: 32,
    object_key: 'raster/new/file.tif',
    original_name: 'file.tif',
    size_bytes: '100',
    sha256: 'abc',
    layer_id: null,
};

describe('remote sensing repository raster source replacement', () => {
    beforeEach(() => jest.clearAllMocks());

    test('reuses an available active layer code and links the new image', async () => {
        query
            .mockResolvedValueOnce({})
            .mockResolvedValueOnce({ rows: [image] })
            .mockResolvedValueOnce({ rows: [{ id: 3 }] })
            .mockResolvedValueOnce({
                rows: [{ id: 3, code: input.code, source_file_id: 32, publish_status: 'pending' }],
            })
            .mockResolvedValueOnce({})
            .mockResolvedValueOnce({});

        await expect(repository.preparePublish(12, input, 7)).resolves.toMatchObject({
            image: { id: 12 },
            layer: { id: 3, source_file_id: 32 },
        });
        expect(query.mock.calls[2][0]).toContain('NOT EXISTS');
        expect(query.mock.calls[3][0]).toContain('UPDATE gis.layers');
        expect(query.mock.calls[4]).toEqual([
            expect.stringContaining('UPDATE raster.satellite_images SET layer_id=$2'),
            [12, 3, 7],
        ]);
        expect(query.mock.calls.some(([sql]) => sql.includes('INSERT INTO gis.layers'))).toBe(
            false,
        );
        expect(release).toHaveBeenCalledTimes(1);
    });

    test('does not reuse a layer still linked to another active image', async () => {
        query
            .mockResolvedValueOnce({})
            .mockResolvedValueOnce({ rows: [image] })
            .mockResolvedValueOnce({ rows: [] })
            .mockResolvedValueOnce({
                rows: [{ id: 13, code: input.code, source_file_id: 32, publish_status: 'pending' }],
            })
            .mockResolvedValueOnce({})
            .mockResolvedValueOnce({});

        await expect(repository.preparePublish(12, input, 7)).resolves.toMatchObject({
            layer: { id: 13 },
        });
        expect(query.mock.calls[3][0]).toContain('INSERT INTO gis.layers');
    });
});

describe('remote sensing repository collection publishing', () => {
    beforeEach(() => jest.clearAllMocks());

    test('updates an existing collection layer without a nonexistent updated_by column', async () => {
        const coverageKey = 'cam-pha-lop-phu-truoc-ngap';
        const collectionInput = {
            ...input,
            code: 'lop_phu_truoc_ngap_ts',
            metadata: {},
        };
        const members = [
            {
                ...image,
                id: 12,
                layer_id: 172,
                acquired_at: '2015-01-01T00:00:00.000Z',
            },
            {
                ...image,
                id: 13,
                layer_id: 172,
                acquired_at: '2018-01-01T00:00:00.000Z',
            },
        ];
        const codeLayer = {
            id: 172,
            code: collectionInput.code,
            storage_kind: 'geotiff_minio',
            publish_status: 'failed',
            metadata: { timeSeries: { enabled: true, coverageKey } },
            deleted_at: null,
        };
        query
            .mockResolvedValueOnce({})
            .mockResolvedValueOnce({ rows: members })
            .mockResolvedValueOnce({ rows: [codeLayer] })
            .mockResolvedValueOnce({ rows: [{ ...codeLayer, publish_status: 'pending' }] })
            .mockResolvedValueOnce({})
            .mockResolvedValueOnce({});

        await expect(
            repository.prepareCollectionPublish(coverageKey, collectionInput, 7, 'tnmt'),
        ).resolves.toMatchObject({
            layer: { id: 172, publish_status: 'pending' },
            values: ['2015-01-01T00:00:00.000Z', '2018-01-01T00:00:00.000Z'],
        });

        const [updateSql, updateParams] = query.mock.calls[3];
        expect(updateSql).toContain('UPDATE gis.layers');
        expect(updateSql).not.toContain('updated_by');
        expect(updateSql).toContain('WHERE id=$9');
        expect(updateParams).toHaveLength(9);
        expect(updateParams[8]).toBe(172);
        expect(release).toHaveBeenCalledTimes(1);
    });
});
