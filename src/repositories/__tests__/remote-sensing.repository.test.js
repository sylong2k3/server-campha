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

beforeEach(() => {
    jest.resetAllMocks();
    db.getClient.mockResolvedValue(db.__client);
});

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

const standaloneLayer = {
    id: 3,
    code: input.code,
    geometry_type: 'RASTER',
    storage_kind: 'geotiff_minio',
    source_file_id: 31,
    object_key: 'raster/old/file.tif',
    has_standalone_source: true,
    metadata: { satelliteImageId: 11 },
};

describe('remote sensing repository raster source replacement', () => {
    test('reuses an available active layer code and links the new image', async () => {
        query
            .mockResolvedValueOnce({})
            .mockResolvedValueOnce({ rows: [image] })
            .mockResolvedValueOnce({ rows: [standaloneLayer] })
            .mockResolvedValueOnce({
                rows: [{ id: 3, code: input.code, source_file_id: 32, publish_status: 'pending' }],
            })
            .mockResolvedValueOnce({})
            .mockResolvedValueOnce({});

        await expect(repository.preparePublish(12, input, 7)).resolves.toMatchObject({
            image: { id: 12 },
            layer: { id: 3, source_file_id: 32 },
        });
        expect(query.mock.calls[2][0]).toContain('AS has_other_standalone');
        expect(query.mock.calls[2][0]).toContain('AS has_collection_members');
        expect(query.mock.calls[2][0]).toContain('s.file_object_id=l.source_file_id');
        expect(query.mock.calls[2][0]).toContain('FOR UPDATE OF l');
        expect(query.mock.calls[3][0]).toContain('UPDATE gis.layers');
        expect(query.mock.calls[4]).toEqual([
            expect.stringContaining('UPDATE raster.satellite_images SET standalone_layer_id=$2'),
            [12, 3, 7],
        ]);
        expect(query.mock.calls.some(([sql]) => sql.includes('INSERT INTO gis.layers'))).toBe(
            false,
        );
        expect(release).toHaveBeenCalledTimes(1);
    });
});

describe('remote sensing repository collection publishing', () => {
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
            geometry_type: 'RASTER',
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

describe('publish target and cleanup safety', () => {
    const coverageKey = 'cam-pha-lop-phu';
    let currentImage;
    let members;
    let layers;
    let jobs;
    beforeEach(() => {
        currentImage = { ...image };
        members = [{ ...image }, { ...image, id: 13, acquired_at: '2018-01-01T00:00:00.000Z' }];
        layers = [];
        jobs = {};
        query.mockImplementation(async (sql, params) => {
            if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql)) {
                return {};
            }
            if (sql.includes('SELECT s.*')) {
                return { rows: [currentImage] };
            }
            if (sql.includes('SELECT s.id,s.scene_code')) {
                return { rows: members };
            }
            if (sql.includes('SELECT l.*')) {
                return { rows: layers };
            }
            if (sql.includes('FROM gis.layer_cleanup_jobs')) {
                return { rows: jobs[params[0]] || [] };
            }
            if (sql.includes('UPDATE gis.layers') || sql.includes('INSERT INTO gis.layers')) {
                return { rows: [{ id: 19, code: input.code, publish_status: 'pending' }] };
            }
            if (sql.includes('UPDATE raster.satellite_images')) {
                return { rowCount: 1 };
            }
            throw new Error(`Unexpected query: ${sql}`);
        });
    });
    const expectNoWrite = () => {
        expect(
            query.mock.calls.some(([sql]) =>
                /(?:UPDATE|INSERT INTO) (?:gis.layers|raster.satellite_images)/.test(sql),
            ),
        ).toBe(false);
        expect(query).toHaveBeenLastCalledWith('ROLLBACK');
        expect(release).toHaveBeenCalled();
    };

    test.each([
        ['time series metadata', { metadata: { timeSeries: { enabled: true } } }],
        ['mosaic marker', { metadata: { geoserverStoreKind: 'imagemosaic_upload' } }],
        ['collection members', { has_collection_members: true }],
        ['vector', { geometry_type: 'POLYGON', storage_kind: 'postgis' }],
        ['unrelated raster', { has_standalone_source: false }],
        ['ingest artifact', { metadata: { rasterIngestJobId: 4 } }],
        ['missing source file', { source_file_id: null }],
    ])('rejects %s through both code and linked ID paths', async (_label, patch) => {
        layers = [{ ...standaloneLayer, ...patch }];
        for (const linkedId of [null, standaloneLayer.id]) {
            currentImage.standalone_layer_id = linkedId;
            await expect(repository.preparePublish(12, input, 7)).rejects.toMatchObject({
                code: 'RASTER_LAYER_TARGET_CONFLICT',
            });
            expectNoWrite();
        }
    });

    test('rejects renaming a linked standalone instead of reusing another store identity', async () => {
        currentImage.standalone_layer_id = 3;
        layers = [{ ...standaloneLayer, code: 'original_code' }];
        await expect(repository.preparePublish(12, input, 7)).rejects.toMatchObject({
            code: 'RASTER_LAYER_TARGET_CONFLICT',
        });
        expectNoWrite();
    });

    test('keeps collection membership while republishing its separate standalone', async () => {
        currentImage = { ...image, layer_id: 172, standalone_layer_id: 3 };
        layers = [standaloneLayer];
        await repository.preparePublish(12, input, 7);
        expect(query.mock.calls.some(([sql]) => sql.includes('SET layer_id='))).toBe(false);
        expect(query).toHaveBeenLastCalledWith('COMMIT');
    });

    test('strips client ownership markers and keeps ordinary metadata', async () => {
        await repository.preparePublish(
            12,
            {
                ...input,
                metadata: {
                    year: 2015,
                    timeSeries: { enabled: true, storeUploaded: true },
                    geoserverStore: 'victim',
                    geoserverStoreKind: 'imagemosaic_upload',
                    geoserverLayer: 'campha:victim',
                    rasterIngestJobId: 77,
                    geoserverPublishCategory: 'victim',
                },
            },
            7,
        );
        const [, params] = query.mock.calls.find(([sql]) => sql.includes('INSERT INTO gis.layers'));
        const metadata = JSON.parse(params[9]);
        expect(metadata).toMatchObject({ year: 2015, satelliteImageId: 12 });
        for (const key of [
            'timeSeries',
            'geoserverStore',
            'geoserverStoreKind',
            'geoserverLayer',
            'rasterIngestJobId',
            'geoserverPublishCategory',
        ]) {
            expect(metadata).not.toHaveProperty(key);
        }
    });

    test.each([
        ['queued', 'queued', 'LAYER_CLEANUP_PENDING'],
        ['running', 'running', 'LAYER_CLEANUP_PENDING'],
        ['failed', 'failed', 'LAYER_CLEANUP_REQUIRED'],
        ['complete', 'failed', 'LAYER_CLEANUP_REQUIRED'],
        ['complete', null, 'LAYER_CLEANUP_REQUIRED'],
        ['none', 'succeeded', 'LAYER_CLEANUP_REQUIRED'],
        ['complete', 'running', 'LAYER_CLEANUP_PENDING'],
    ])(
        'blocks stale links with layer=%s job=%s in both flows',
        async (cleanupStatus, jobStatus, code) => {
            layers = [
                {
                    ...standaloneLayer,
                    code: 'old_code',
                    deleted_at: '2026-01-01',
                    cleanup_status: cleanupStatus,
                },
            ];
            jobs[3] = jobStatus
                ? [{ status: jobStatus, has_active_job: ['queued', 'running'].includes(jobStatus) }]
                : [];
            currentImage.standalone_layer_id = 3;
            members[0].layer_id = 3;
            await expect(repository.preparePublish(12, input, 7)).rejects.toMatchObject({ code });
            await expect(
                repository.prepareCollectionPublish(coverageKey, input, 7),
            ).rejects.toMatchObject({ code });
            expectNoWrite();
        },
    );

    test('relinks only touched standalone after proven cleanup using a new code', async () => {
        layers = [
            {
                ...standaloneLayer,
                code: 'old_code',
                deleted_at: '2026-01-01',
                cleanup_status: 'complete',
            },
        ];
        jobs[3] = [{ status: 'succeeded', has_active_job: false }];
        currentImage.standalone_layer_id = 3;
        currentImage.layer_id = 172;
        await repository.preparePublish(12, input, 7);
        expect(query).toHaveBeenCalledWith(
            expect.stringContaining('SET standalone_layer_id=$2'),
            [12, 19, 7],
        );
        expect(query.mock.calls.some(([sql]) => sql.includes('SET layer_id='))).toBe(false);
    });

    test('recovers completed collection links before checking multiple linked IDs', async () => {
        layers = [3, 4].map((id) => ({
            id,
            code: `old_${id}`,
            deleted_at: '2026-01-01',
            cleanup_status: 'complete',
        }));
        jobs[3] = jobs[4] = [{ status: 'succeeded', has_active_job: false }];
        members[0].layer_id = 3;
        members[1].layer_id = 4;
        await repository.prepareCollectionPublish(coverageKey, input, 7);
        expect(query).toHaveBeenCalledWith(expect.stringContaining('SET layer_id=$2'), [
            [12, 13],
            19,
            7,
        ]);
        expect(query.mock.calls.some(([sql]) => sql.includes('SET standalone_layer_id='))).toBe(
            false,
        );
    });

    test('never reuses a retired code even after cleanup', async () => {
        layers = [{ ...standaloneLayer, deleted_at: '2026-01-01', cleanup_status: 'complete' }];
        jobs[3] = [{ status: 'succeeded', has_active_job: false }];
        await expect(repository.preparePublish(12, input, 7)).rejects.toMatchObject({
            code: 'LAYER_CODE_RETIRED',
        });
        await expect(
            repository.prepareCollectionPublish(coverageKey, input, 7),
        ).rejects.toMatchObject({ code: 'LAYER_CODE_RETIRED' });
        expectNoWrite();
    });

    test('rejects mixing active collections and adopting standalone as collection', async () => {
        members[0].layer_id = 3;
        members[1].layer_id = 4;
        layers = [{ id: 3 }, { id: 4 }];
        await expect(
            repository.prepareCollectionPublish(coverageKey, input, 7),
        ).rejects.toMatchObject({ code: 'COLLECTION_MEMBER_CONFLICT' });
        members.forEach((member) => {
            member.layer_id = null;
        });
        layers = [standaloneLayer];
        await expect(
            repository.prepareCollectionPublish(coverageKey, input, 7),
        ).rejects.toMatchObject({ code: 'COLLECTION_LAYER_CONFLICT' });
        expectNoWrite();
    });

    test('preserves SQL chronological order, not upload IDs, with independent standalone links', async () => {
        members[0].id = 99;
        members[0].standalone_layer_id = 3;
        members[1].standalone_layer_id = 4;
        const result = await repository.prepareCollectionPublish(
            coverageKey,
            { ...input, metadata: { timeSeries: { storeUploaded: true } } },
            7,
        );
        expect(result.values).toEqual(['2015-01-01T00:00:00.000Z', '2018-01-01T00:00:00.000Z']);
        expect(query.mock.calls[1][0]).toContain('ORDER BY s.acquired_at,s.id');
        expect(query.mock.calls.some(([sql]) => sql.includes('SET standalone_layer_id='))).toBe(
            false,
        );
        const [, params] = query.mock.calls.find(([sql]) => sql.includes('INSERT INTO gis.layers'));
        expect(JSON.parse(params[7]).timeSeries).toEqual({
            enabled: true,
            mode: 'discrete',
            coverageKey,
        });
    });

    test('rejects duplicate timestamps before any layer writes', async () => {
        members[1].acquired_at = '2015-01-01T07:00:00+07:00';
        await expect(
            repository.prepareCollectionPublish(coverageKey, input, 7),
        ).rejects.toMatchObject({ code: 'DUPLICATE_COLLECTION_TIME' });
        expectNoWrite();
    });

    test('reads both independent layer links without exposing object paths', async () => {
        db.query.mockResolvedValue({ rows: [{ id: 12, layer_id: 172, standalone_layer_id: 3 }] });
        await expect(repository.find(12)).resolves.toMatchObject({
            layer_id: 172,
            standalone_layer_id: 3,
        });
        expect(db.query.mock.calls[0][0]).toContain('s.layer_id,s.standalone_layer_id');
        expect(db.query.mock.calls[0][0]).not.toContain('f.object_key');
    });
});

describe('remote sensing repository coverage key and merge locking', () => {
    test('updateCoverageKey acquires sorted advisory locks and updates row', async () => {
        const currentImage = {
            id: 12,
            coverage_key: 'target_key',
            acquired_at: '2025-01-01T00:00:00.000Z',
            layer_id: null,
            standalone_layer_id: 5,
        };
        // 1. BEGIN
        // 2. SELECT s.* FOR UPDATE
        // 3. lock key 1 (alpha sorted: 'source_key')
        // 4. lock key 2 ('target_key')
        // 5. duplicate check
        // 6. UPDATE
        // 7. COMMIT
        currentImage.coverage_key = 'source_key';
        query
            .mockResolvedValueOnce({}) // BEGIN
            .mockResolvedValueOnce({ rows: [currentImage] }) // SELECT image
            .mockResolvedValueOnce({}) // advisory lock source_key
            .mockResolvedValueOnce({}) // advisory lock target_key
            .mockResolvedValueOnce({ rows: [] }) // duplicate check
            .mockResolvedValueOnce({ rows: [{ ...currentImage, coverage_key: 'target_key' }] }) // UPDATE
            .mockResolvedValueOnce({}); // COMMIT

        const result = await repository.updateCoverageKey(12, 'target_key', 7);
        expect(result).toMatchObject({ id: 12, coverage_key: 'target_key' });
        expect(query.mock.calls[2][0]).toContain('pg_advisory_xact_lock');
        expect(query.mock.calls[2][1]).toEqual(['source_key']);
        expect(query.mock.calls[3][0]).toContain('pg_advisory_xact_lock');
        expect(query.mock.calls[3][1]).toEqual(['target_key']);
    });

    test('updateCoverageKey blocks moving active collection members', async () => {
        const currentImage = {
            id: 12,
            coverage_key: 'source_key',
            acquired_at: '2025-01-01T00:00:00.000Z',
            layer_id: 88,
            standalone_layer_id: 5,
        };
        query
            .mockResolvedValueOnce({}) // BEGIN
            .mockResolvedValueOnce({ rows: [currentImage] }) // SELECT image
            .mockResolvedValueOnce({}) // advisory lock 1
            .mockResolvedValueOnce({}) // advisory lock 2
            .mockResolvedValueOnce({ rows: [{ id: 88, deleted_at: null, cleanup_status: 'none' }] }) // active layer check
            .mockResolvedValueOnce({}); // ROLLBACK

        const result = await repository.updateCoverageKey(12, 'target_key', 7);
        expect(result).toEqual({ conflict: 'TIME_SERIES_MEMBER' });
    });

    test('mergeCollections acquires sorted advisory locks and updates exact source IDs', async () => {
        const sourceImages = [
            { id: 10, acquired_at: '2024-01-01T00:00:00.000Z', coverage_key: 'src_b', layer_id: null, standalone_layer_id: 1 },
            { id: 11, acquired_at: '2024-06-01T00:00:00.000Z', coverage_key: 'src_a', layer_id: null, standalone_layer_id: 2 },
        ];
        const targetImages = [
            { id: 20, acquired_at: '2025-01-01T00:00:00.000Z' },
        ];

        query
            .mockResolvedValueOnce({}) // BEGIN
            .mockResolvedValueOnce({}) // advisory lock 'src_a'
            .mockResolvedValueOnce({}) // advisory lock 'src_b'
            .mockResolvedValueOnce({}) // advisory lock 'tgt_c'
            .mockResolvedValueOnce({ rows: sourceImages }) // select source
            .mockResolvedValueOnce({ rows: targetImages }) // select target
            .mockResolvedValueOnce({ rowCount: 2 }) // UPDATE
            .mockResolvedValueOnce({}); // COMMIT

        const result = await repository.mergeCollections(['src_b', 'src_a'], 'tgt_c', 7);
        expect(result).toEqual({ updatedCount: 2, targetCoverageKey: 'tgt_c' });
        // Verify sorted lock calls: 'src_a', 'src_b', 'tgt_c'
        expect(query.mock.calls[1][1]).toEqual(['src_a']);
        expect(query.mock.calls[2][1]).toEqual(['src_b']);
        expect(query.mock.calls[3][1]).toEqual(['tgt_c']);
        // Verify exact ID update
        const updateCall = query.mock.calls[6];
        expect(updateCall[0]).toContain('WHERE id = ANY($3::bigint[])');
        expect(updateCall[1]).toEqual(['tgt_c', 7, [10, 11]]);
    });

    test('mergeCollections rejects source images linked to an active collection layer', async () => {
        const sourceImages = [
            { id: 10, acquired_at: '2024-01-01T00:00:00.000Z', coverage_key: 'src_a', layer_id: 99, standalone_layer_id: 1 },
        ];
        query
            .mockResolvedValueOnce({}) // BEGIN
            .mockResolvedValueOnce({}) // advisory lock 1
            .mockResolvedValueOnce({}) // advisory lock 2
            .mockResolvedValueOnce({ rows: sourceImages }) // select source
            .mockResolvedValueOnce({ rows: [{ id: 99, code: 'ts_active', deleted_at: null, cleanup_status: 'none' }] }) // layer check
            .mockResolvedValueOnce({}); // ROLLBACK

        await expect(repository.mergeCollections(['src_a'], 'tgt_b', 7)).rejects.toMatchObject({
            code: 'COLLECTION_MEMBER_CONFLICT',
        });
    });

    test('mergeCollections rejects duplicate timestamps across source and target', async () => {
        const sourceImages = [
            { id: 10, acquired_at: '2025-01-01T00:00:00.000Z', coverage_key: 'src_a', layer_id: null },
        ];
        const targetImages = [
            { id: 20, acquired_at: '2025-01-01T00:00:00.000Z' },
        ];
        query
            .mockResolvedValueOnce({}) // BEGIN
            .mockResolvedValueOnce({}) // advisory lock 1
            .mockResolvedValueOnce({}) // advisory lock 2
            .mockResolvedValueOnce({ rows: sourceImages }) // select source
            .mockResolvedValueOnce({ rows: targetImages }) // select target
            .mockResolvedValueOnce({}); // ROLLBACK

        await expect(repository.mergeCollections(['src_a'], 'tgt_b', 7)).rejects.toMatchObject({
            code: 'DUPLICATE_COLLECTION_TIME',
        });
    });
});

describe('remote sensing repository admin queries', () => {
    test('listAdmin builds layer joins and maps lifecycle sub-objects', async () => {
        const rawRow = {
            id: 1,
            scene_code: 'S1',
            title: 'Title 1',
            platform: 'sentinel-2',
            thematic_group: 'water',
            coverage_key: 'cp_water',
            acquired_at: '2025-01-01T00:00:00.000Z',
            product_level: 'L2',
            resolution_m: '10.00',
            cloud_cover_percent: '1.50',
            orbit_number: 10,
            description: 'test',
            layer_id: 20,
            standalone_layer_id: 10,
            original_name: 'test.tif',
            size_bytes: '1024',
            created_at: '2025-01-01T00:00:00.000Z',
            updated_at: '2025-01-01T00:00:00.000Z',
            sl_id: 10,
            sl_code: 'sl_code_1',
            sl_name_vi: 'Lớp đơn',
            sl_publish_status: 'published',
            sl_cleanup_status: 'none',
            sl_deleted_at: null,
            tl_id: 20,
            tl_code: 'tl_code_1',
            tl_name_vi: 'Lớp chuỗi',
            tl_publish_status: 'published',
            tl_cleanup_status: 'none',
            tl_deleted_at: null,
            total_count: 1,
        };

        db.query.mockResolvedValueOnce({ rows: [rawRow] });

        const result = await repository.listAdmin({
            page: 1,
            limit: 20,
            coverageKey: 'cp_water',
            status: 'in_use',
            sort: 'acquiredAt:desc',
        });

        expect(result.total).toBe(1);
        expect(result.items[0]).toMatchObject({
            id: 1,
            standaloneLayer: {
                id: 10,
                code: 'sl_code_1',
                nameVi: 'Lớp đơn',
                publishStatus: 'published',
            },
            timeSeriesLayer: {
                id: 20,
                code: 'tl_code_1',
                nameVi: 'Lớp chuỗi',
                publishStatus: 'published',
            },
        });
        const [sql, params] = db.query.mock.calls[0];
        expect(sql).toContain('LEFT JOIN gis.layers sl ON sl.id=s.standalone_layer_id');
        expect(sql).toContain('LEFT JOIN gis.layers tl ON tl.id=s.layer_id');
        expect(sql).toContain('s.coverage_key=');
        expect(sql).toContain('(sl.deleted_at IS NULL OR tl.deleted_at IS NULL)');
        expect(params).toContain('cp_water');
    });

    test('listCollections aggregates groups and calculates duplicate dates', async () => {
        const row = {
            coverage_key: 'cp_group',
            thematic_group: 'urban',
            total_images: 3,
            unique_dates: 2,
            earliest_acquired_at: '2024-01-01T00:00:00.000Z',
            latest_acquired_at: '2025-01-01T00:00:00.000Z',
            has_duplicate_dates: true,
            duplicate_date_count: 1,
            is_publishable: false,
            cl_id: 50,
            cl_code: 'cp_group_ts',
            cl_name_vi: 'Lớp chuỗi đô thị',
            cl_publish_status: 'published',
            cl_cleanup_status: 'none',
            cl_deleted_at: null,
            total_count: 1,
        };

        db.query.mockResolvedValueOnce({ rows: [row] });

        const result = await repository.listCollections({
            page: 1,
            limit: 10,
            sort: 'latestAcquiredAt:desc',
        });

        expect(result.total).toBe(1);
        expect(result.items[0]).toEqual({
            coverageKey: 'cp_group',
            thematicGroup: 'urban',
            totalImages: 3,
            uniqueDates: 2,
            earliestAcquiredAt: '2024-01-01T00:00:00.000Z',
            latestAcquiredAt: '2025-01-01T00:00:00.000Z',
            hasDuplicateDates: true,
            duplicateDateCount: 1,
            isPublishable: false,
            collectionLayer: {
                id: 50,
                code: 'cp_group_ts',
                nameVi: 'Lớp chuỗi đô thị',
                publishStatus: 'published',
                cleanupStatus: 'none',
                deletedAt: null,
            },
        });
        const [sql] = db.query.mock.calls[0];
        expect(sql).toContain('LEFT JOIN LATERAL');
        expect(sql).toContain('GROUP BY s.coverage_key');
    });
});


