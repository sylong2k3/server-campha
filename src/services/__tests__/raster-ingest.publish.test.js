'use strict';

const path = require('path');
const os = require('os');
const {
    publishToGeoServer,
    upsertRasterLayer,
    backLinkResource,
    DEFAULT_ANALYSIS_EPSG,
} = require('../raster-ingest.publish');

const silence = () => {
    const spies = {
        info: jest.spyOn(console, 'info').mockImplementation(() => {}),
        warn: jest.spyOn(console, 'warn').mockImplementation(() => {}),
        error: jest.spyOn(console, 'error').mockImplementation(() => {}),
        debug: jest.spyOn(console, 'debug').mockImplementation(() => {}),
    };
    return () => {
        for (const spy of Object.values(spies)) {
            spy.mockRestore();
        }
    };
};

const makeFsp = () => ({
    mkdir: jest.fn().mockResolvedValue(undefined),
    copyFile: jest.fn().mockResolvedValue(undefined),
});

const makeGeoserver = () => ({
    publishFsGeoTiffLayer: jest.fn().mockResolvedValue('campha:cp_flood_event_1'),
    truncateGwcLayer: jest.fn().mockResolvedValue(undefined),
    verifyLayer: jest.fn().mockResolvedValue({ name: 'cp_flood_event_1' }),
});

describe('publishToGeoServer', () => {
    let unsilence;
    const prevGsDir = process.env.GEOSERVER_DATA_DIR;
    beforeEach(() => {
        unsilence = silence();
        process.env.GEOSERVER_DATA_DIR = path.join(os.tmpdir(), 'gs-test');
    });
    afterEach(() => {
        unsilence();
        if (prevGsDir === undefined) {
            delete process.env.GEOSERVER_DATA_DIR;
        } else {
            process.env.GEOSERVER_DATA_DIR = prevGsDir;
        }
    });

    test('copies COG into GEOSERVER_DATA_DIR/raster and publishes', async () => {
        const fsp = makeFsp();
        const geoserver = makeGeoserver();
        const result = await publishToGeoServer(
            { storeName: 'cp_flood_event_1', cogPath: '/tmp/x.tif', params: { nameVi: 'Ngập' } },
            {
                geoserver,
                fsPromises: fsp,
                layerRepo: { findByCode: jest.fn().mockResolvedValue(null) },
            },
        );
        expect(fsp.mkdir).toHaveBeenCalledWith(expect.stringMatching(/raster$/), {
            recursive: true,
        });
        expect(fsp.copyFile).toHaveBeenCalledWith(
            '/tmp/x.tif',
            expect.stringMatching(/cp_flood_event_1\.tif$/),
        );
        expect(geoserver.publishFsGeoTiffLayer).toHaveBeenCalledWith(
            expect.objectContaining({
                storeName: 'cp_flood_event_1',
                title: 'Ngập',
                enabled: true,
            }),
        );
        expect(result.geoserverLayer).toBe('campha:cp_flood_event_1');
        expect(result.isReingest).toBe(false);
    });

    test('detects re-ingest via layerRepo.findByCode and truncates GWC', async () => {
        const fsp = makeFsp();
        const geoserver = makeGeoserver();
        const layerRepo = {
            findByCode: jest.fn().mockResolvedValue({
                id: 9,
                geoserver_layer: 'campha:cp_flood_event_1',
            }),
        };
        const result = await publishToGeoServer(
            { storeName: 'cp_flood_event_1', cogPath: '/tmp/x.tif', params: {} },
            { geoserver, fsPromises: fsp, layerRepo },
        );
        expect(result.isReingest).toBe(true);
        expect(geoserver.truncateGwcLayer).toHaveBeenCalledWith('campha:cp_flood_event_1');
    });

    test('rejects when GEOSERVER_DATA_DIR is not set', async () => {
        delete process.env.GEOSERVER_DATA_DIR;
        await expect(
            publishToGeoServer(
                { storeName: 'x', cogPath: '/tmp/x.tif', params: {} },
                { geoserver: makeGeoserver(), fsPromises: makeFsp() },
            ),
        ).rejects.toThrow(/GEOSERVER_DATA_DIR/);
    });

    test('a GWC truncate failure is logged, not thrown', async () => {
        const fsp = makeFsp();
        const geoserver = makeGeoserver();
        geoserver.truncateGwcLayer.mockRejectedValue(new Error('GWC down'));
        const layerRepo = {
            findByCode: jest.fn().mockResolvedValue({ id: 1, geoserver_layer: 'campha:x' }),
        };
        await expect(
            publishToGeoServer(
                { storeName: 'x', cogPath: '/tmp/x.tif', params: {} },
                { geoserver, fsPromises: fsp, layerRepo },
            ),
        ).resolves.toMatchObject({ isReingest: true });
    });
});

describe('upsertRasterLayer', () => {
    let unsilence;
    beforeEach(() => {
        unsilence = silence();
    });
    afterEach(() => unsilence());

    const makeDb = () => {
        const client = {
            query: jest.fn().mockResolvedValue({ rowCount: 1 }),
            release: jest.fn(),
        };
        return { pool: { connect: jest.fn().mockResolvedValue(client) }, __client: client };
    };

    test('runs the upsert inside a BEGIN/COMMIT and calls updatePublishedMetadata when supplied', async () => {
        const db = makeDb();
        const layerRepo = {
            upsertLayerByCode: jest.fn().mockResolvedValue({ id: 17 }),
            updatePublishedMetadata: jest.fn().mockResolvedValue(undefined),
        };
        const result = await upsertRasterLayer(
            {
                job: {
                    id: 1,
                    layer_code: 'cp_flood_event_1',
                    source_url: 'http://x',
                    created_by: 3,
                },
                params: {},
                storeName: 'cp_flood_event_1',
                geoserverLayer: 'campha:cp_flood_event_1',
                objectKey: 'flood/2026/08/cp_flood_event_1/job_1.tif',
                sha: 'a'.repeat(64),
            },
            { db, layerRepo },
        );
        expect(result).toEqual({ id: 17 });
        expect(layerRepo.upsertLayerByCode).toHaveBeenCalled();
        expect(layerRepo.updatePublishedMetadata).toHaveBeenCalledWith(
            db.__client,
            17,
            expect.objectContaining({
                geoserverLayer: 'campha:cp_flood_event_1',
                geoserverStore: 'cp_flood_event_1',
                geoserverPublishCategory: 'raster',
            }),
        );
        const queries = db.__client.query.mock.calls.map((c) => c[0]);
        expect(queries).toContain('BEGIN');
        expect(queries).toContain('COMMIT');
        expect(db.__client.release).toHaveBeenCalled();
    });

    test('fails closed when the repo lacks updatePublishedMetadata', async () => {
        const db = makeDb();
        const layerRepo = {
            upsertLayerByCode: jest.fn().mockResolvedValue({ id: 42 }),
        };
        await expect(
            upsertRasterLayer(
                {
                    job: { id: 2, layer_code: 'y', source_url: 'http://y' },
                    params: {},
                    storeName: 'y',
                    geoserverLayer: 'campha:y',
                    objectKey: 'flood/2026/08/y/job_2.tif',
                    sha: 'b'.repeat(64),
                },
                { db, layerRepo },
            ),
        ).rejects.toThrow(/updatePublishedMetadata/);
    });

    test('rolls back on failure and re-throws', async () => {
        const db = makeDb();
        const boom = new Error('layer_registry constraint');
        const layerRepo = {
            upsertLayerByCode: jest.fn().mockRejectedValue(boom),
        };
        await expect(
            upsertRasterLayer(
                {
                    job: { id: 3, layer_code: 'z', source_url: 'http://z' },
                    params: {},
                    storeName: 'z',
                    geoserverLayer: 'campha:z',
                    objectKey: 'flood/2026/08/z/job_3.tif',
                    sha: 'c'.repeat(64),
                },
                { db, layerRepo },
            ),
        ).rejects.toBe(boom);
        const rawQueries = db.__client.query.mock.calls.map((c) => c[0]);
        expect(rawQueries).toContain('ROLLBACK');
        expect(db.__client.release).toHaveBeenCalled();
    });

    test('rejects when an injected layerRepo is incomplete', async () => {
        const db = makeDb();
        await expect(
            upsertRasterLayer(
                {
                    job: { id: 4, layer_code: 'x' },
                    params: {},
                    storeName: 'x',
                    geoserverLayer: 'campha:x',
                    objectKey: 'k',
                    sha: 'd'.repeat(64),
                },
                { db, layerRepo: {} },
            ),
        ).rejects.toThrow(/layerRepo/);
    });

    test('applies DEFAULT_ANALYSIS_EPSG when params.epsg_code is unset', async () => {
        const db = makeDb();
        const layerRepo = {
            upsertLayerByCode: jest.fn().mockResolvedValue({ id: 1 }),
            updatePublishedMetadata: jest.fn().mockResolvedValue(undefined),
        };
        await upsertRasterLayer(
            {
                job: { id: 5, layer_code: 'q', source_url: 'http://q' },
                params: {},
                storeName: 'q',
                geoserverLayer: 'campha:q',
                objectKey: 'flood/2026/08/q/job_5.tif',
                sha: 'e'.repeat(64),
            },
            { db, layerRepo },
        );
        expect(layerRepo.upsertLayerByCode).toHaveBeenCalledWith(
            db.__client,
            expect.objectContaining({ epsg_code: DEFAULT_ANALYSIS_EPSG }),
        );
    });
});

describe('backLinkResource', () => {
    let unsilence;
    beforeEach(() => {
        unsilence = silence();
    });
    afterEach(() => unsilence());

    const makeDbForBacklink = () => ({
        query: jest.fn().mockResolvedValue({ rowCount: 1 }),
    });

    test('updates gis.flood_artifacts for a valid flood_artifact link', async () => {
        const db = makeDbForBacklink();
        const result = await backLinkResource(
            { type: 'flood_artifact', id: 7 },
            {
                geoserverLayer: 'campha:cp_flood_event_1',
                geoserverStore: 'cp_flood_event_1',
                minioCategory: 'flood-rasters',
                minioKey: 'flood/2026/08/x/job.tif',
            },
            { db },
        );
        expect(result.rowCount).toBe(1);
        expect(db.query).toHaveBeenCalledWith(
            expect.stringMatching(/UPDATE gis\.flood_artifacts/),
            expect.arrayContaining([7, 'campha', 'cp_flood_event_1']),
        );
    });

    test('publishes one forest snapshot and cleans older period artifacts', async () => {
        const db = {
            query: jest.fn().mockResolvedValue({
                rows: [
                    {
                        row_count: 1,
                        cleared_count: 2,
                        retired_layer_count: 1,
                        old_minio_keys: ['raster/legacy/job_4.tif', 'raster/current/latest.tif'],
                    },
                ],
            }),
        };
        const minio = { removeObject: jest.fn().mockResolvedValue(undefined) };

        const result = await backLinkResource(
            { type: 'forest_snapshot', id: 12 },
            {
                geoserverLayer: 'campha:forest_classification_202607',
                geoserverStore: 'forest_classification_202607',
                minioCategory: 'raster',
                minioKey: 'raster/current/latest.tif',
            },
            { db, minio },
        );

        expect(result).toEqual({ rowCount: 1, clearedCount: 2, retiredLayerCount: 1 });
        expect(db.query.mock.calls[0][0]).toMatch(/previous_artifacts AS MATERIALIZED/);
        expect(db.query.mock.calls[0][0]).toMatch(/status = CASE WHEN old\.status = 'published'/);
        expect(db.query.mock.calls[0][0]).toMatch(/INSERT INTO gis\.layer_cleanup_jobs/);
        expect(minio.removeObject).toHaveBeenCalledTimes(1);
        expect(minio.removeObject).toHaveBeenCalledWith({
            objectKey: 'raster/legacy/job_4.tif',
            category: 'raster',
        });
    });

    test('warns and skips unsupported legacy backlink types', async () => {
        const db = makeDbForBacklink();
        const result = await backLinkResource(
            { type: 'unsupported_type', id: 1 },
            { geoserverLayer: 'x:y' },
            { db },
        );
        expect(result.skipped).toBe(true);
        expect(db.query).not.toHaveBeenCalled();
    });

    test('skips silently for missing type or id', async () => {
        const db = makeDbForBacklink();
        expect(await backLinkResource(null, {}, { db })).toEqual({ skipped: true });
        expect(await backLinkResource({ type: 'flood_artifact' }, {}, { db })).toEqual({
            skipped: true,
        });
        expect(await backLinkResource({ id: 5 }, {}, { db })).toEqual({ skipped: true });
        expect(db.query).not.toHaveBeenCalled();
    });

    test('warns when the UPDATE affects zero rows (target row missing)', async () => {
        const db = { query: jest.fn().mockResolvedValue({ rowCount: 0 }) };
        const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
        try {
            await backLinkResource(
                { type: 'flood_artifact', id: 999 },
                { geoserverLayer: 'campha:x' },
                { db },
            );
            expect(warnSpy).toHaveBeenCalledWith(
                expect.stringContaining('backlink flood_artifact#999 → 0 rows updated'),
            );
        } finally {
            warnSpy.mockRestore();
        }
    });
});
