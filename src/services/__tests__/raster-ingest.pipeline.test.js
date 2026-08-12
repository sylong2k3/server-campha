'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const {
    runJob,
    ALLOWED_CRS,
    PIPELINE_ERROR_CODES,
    sha256File,
    buildObjectKey,
    extractEpsgFromWkt,
} = require('../raster-ingest.pipeline');

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

const II_TIFF = Buffer.from([0x49, 0x49, 0x2a, 0x00, 0xff, 0xff]);
const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0xff, 0xff]);
const GARBAGE = Buffer.from([0x00, 0x01, 0x02, 0x03, 0xff]);

const makeRepo = () => ({
    updateStatus: jest.fn().mockResolvedValue(undefined),
    saveOutput: jest.fn().mockResolvedValue(undefined),
    incrementRetry: jest.fn().mockResolvedValue(undefined),
    moveToDlq: jest.fn().mockResolvedValue(undefined),
});

const makeMinio = () => ({
    uploadStream: jest.fn().mockResolvedValue({ etag: 'abc' }),
});

const makePublisher = () => ({
    publishToGeoServer: jest
        .fn()
        .mockResolvedValue({ geoserverLayer: 'campha:cp_flood_event_1', isReingest: false }),
    upsertRasterLayer: jest.fn().mockResolvedValue({ id: 55 }),
    backLinkResource: jest.fn().mockResolvedValue(undefined),
});

// A download stub that writes the given payload to `destPath` and returns
// the standard shape http-stream-download.util produces.
const makeDownload = (payload) =>
    jest.fn(async (_url, destPath) => {
        await fs.promises.writeFile(destPath, payload);
        return {
            bytes: payload.length,
            sha256: 'deadbeef' + '0'.repeat(56),
            contentType: 'application/octet-stream',
        };
    });

describe('helpers', () => {
    test('extractEpsgFromWkt picks the innermost EPSG authority', () => {
        expect(
            extractEpsgFromWkt('PROJCS["a", GEOGCS[..., ID["EPSG",4326]], ID["EPSG",32648]]'),
        ).toBe('EPSG:32648');
    });

    test('extractEpsgFromWkt returns null when no EPSG code is present', () => {
        expect(extractEpsgFromWkt('LOCAL_CS["custom"]')).toBeNull();
        expect(extractEpsgFromWkt(null)).toBeNull();
    });

    test('buildObjectKey namespaces by year/month + safe layer code', () => {
        const key = buildObjectKey({ layer_code: 'cp_flood_event' }, 'job_7');
        expect(key).toMatch(/^flood\/\d{4}\/\d{2}\/cp_flood_event\/job_7\.tif$/);
    });

    test('sha256File computes the checksum of a real file', async () => {
        const tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'sha-test-'));
        try {
            const p = path.join(tmp, 'x.bin');
            await fs.promises.writeFile(p, Buffer.from('hello'));
            const digest = await sha256File(p);
            // Known SHA-256 for "hello".
            expect(digest).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
        } finally {
            await fs.promises.rm(tmp, { recursive: true, force: true });
        }
    });

    test('ALLOWED_CRS contains the flood analysis and standard basemap CRS', () => {
        expect(ALLOWED_CRS.has('EPSG:32648')).toBe(true);
        expect(ALLOWED_CRS.has('EPSG:4326')).toBe(true);
        expect(ALLOWED_CRS.has('EPSG:3857')).toBe(false);
    });
});

describe('runJob (happy path)', () => {
    let unsilence;
    beforeEach(() => {
        unsilence = silence();
    });
    afterEach(() => {
        unsilence();
    });

    test('walks download → validate → CRS → upload → publish → registry', async () => {
        const repo = makeRepo();
        const minio = makeMinio();
        const publisher = makePublisher();
        const download = makeDownload(II_TIFF);
        const validateCrs = jest.fn().mockResolvedValue({ crs: 'EPSG:32648' });
        const result = await runJob(
            {
                id: 1,
                layer_code: 'cp_flood_event',
                source_url: 'https://x/y',
                retry_count: 0,
                request_params: {},
            },
            { repo, minio, publisher, download, validateCrs },
        );
        expect(result.geoserverLayer).toBe('campha:cp_flood_event_1');
        expect(validateCrs).toHaveBeenCalled();
        // State transitions
        const statuses = repo.updateStatus.mock.calls.map((c) => c[1].status);
        expect(statuses).toEqual(['validating', 'uploading', 'publishing', 'completed']);
        expect(minio.uploadStream).toHaveBeenCalledWith(
            expect.objectContaining({ category: 'flood-rasters' }),
        );
        expect(publisher.publishToGeoServer).toHaveBeenCalled();
        expect(publisher.upsertRasterLayer).toHaveBeenCalled();
        expect(repo.saveOutput).toHaveBeenCalledWith(1, expect.objectContaining({ layerId: 55 }));
    });

    test('lets the caller override the bucket category via request_params', async () => {
        const repo = makeRepo();
        const minio = makeMinio();
        const publisher = makePublisher();
        const download = makeDownload(II_TIFF);
        const validateCrs = jest.fn().mockResolvedValue({ crs: 'EPSG:32648' });
        await runJob(
            {
                id: 2,
                layer_code: 'cp_flood_cal',
                source_url: 'https://x/y',
                retry_count: 0,
                request_params: { bucketCategory: 'flood-calibration' },
            },
            { repo, minio, publisher, download, validateCrs },
        );
        expect(minio.uploadStream).toHaveBeenCalledWith(
            expect.objectContaining({ category: 'flood-calibration' }),
        );
    });
});

describe('runJob (failure branches)', () => {
    let unsilence;
    beforeEach(() => {
        unsilence = silence();
    });
    afterEach(() => {
        unsilence();
    });

    test('classifies ZIP payloads with ZIP_NOT_YET_SUPPORTED', async () => {
        const repo = makeRepo();
        const download = makeDownload(ZIP_MAGIC);
        await expect(
            runJob(
                {
                    id: 3,
                    layer_code: 'zip',
                    source_url: 'https://x/y',
                    retry_count: 0,
                    request_params: {},
                },
                {
                    repo,
                    minio: makeMinio(),
                    publisher: makePublisher(),
                    download,
                    validateCrs: jest.fn(),
                },
            ),
        ).rejects.toMatchObject({ code: PIPELINE_ERROR_CODES.ZIP_NOT_YET_SUPPORTED });
    });

    test('classifies non-TIFF non-ZIP payloads with NOT_A_TIFF', async () => {
        const repo = makeRepo();
        const download = makeDownload(GARBAGE);
        await expect(
            runJob(
                {
                    id: 4,
                    layer_code: 'garbage',
                    source_url: 'https://x/y',
                    retry_count: 0,
                    request_params: {},
                },
                {
                    repo,
                    minio: makeMinio(),
                    publisher: makePublisher(),
                    download,
                    validateCrs: jest.fn(),
                },
            ),
        ).rejects.toMatchObject({ code: PIPELINE_ERROR_CODES.NOT_A_TIFF });
    });

    test('rejects unsupported CRS (§22-F guard)', async () => {
        const repo = makeRepo();
        const download = makeDownload(II_TIFF);
        const validateCrs = jest.fn().mockResolvedValue({ crs: 'EPSG:3857' });
        await expect(
            runJob(
                {
                    id: 5,
                    layer_code: 'bad_crs',
                    source_url: 'https://x/y',
                    retry_count: 0,
                    request_params: {},
                },
                {
                    repo,
                    minio: makeMinio(),
                    publisher: makePublisher(),
                    download,
                    validateCrs,
                },
            ),
        ).rejects.toMatchObject({ code: PIPELINE_ERROR_CODES.UNSUPPORTED_CRS });
    });

    test('fails closed when GDAL is not installed', async () => {
        const repo = makeRepo();
        const download = makeDownload(II_TIFF);
        const validateCrs = jest.fn(() => {
            const err = new Error('gdalinfo not found');
            err.code = PIPELINE_ERROR_CODES.GDALINFO_UNAVAILABLE;
            return Promise.reject(err);
        });
        await expect(
            runJob(
                {
                    id: 6,
                    layer_code: 'no_gdal',
                    source_url: 'https://x/y',
                    retry_count: 0,
                    request_params: {},
                },
                {
                    repo,
                    minio: makeMinio(),
                    publisher: makePublisher(),
                    download,
                    validateCrs,
                },
            ),
        ).rejects.toMatchObject({ code: PIPELINE_ERROR_CODES.GDALINFO_UNAVAILABLE });
    });

    test('runs the retry policy on any failure and re-throws', async () => {
        const repo = makeRepo();
        const download = jest.fn(async () => {
            const err = new Error('boom');
            err.code = 'STREAM_ERROR';
            throw err;
        });
        await expect(
            runJob(
                {
                    id: 7,
                    layer_code: 'x',
                    source_url: 'https://x/y',
                    retry_count: 0,
                    request_params: {},
                },
                { repo, minio: makeMinio(), publisher: makePublisher(), download },
            ),
        ).rejects.toThrow('boom');
        expect(repo.incrementRetry).toHaveBeenCalled();
    });

    test('rejects when the repository is not present', async () => {
        await expect(
            runJob(
                {
                    id: 8,
                    layer_code: 'x',
                    source_url: 'https://x/y',
                    retry_count: 0,
                    request_params: {},
                },
                { repo: null },
            ),
        ).rejects.toThrow(/needs a repository/);
    });
});
