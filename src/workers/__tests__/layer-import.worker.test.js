'use strict';

jest.mock('../../configs/database', () => ({
    query: jest.fn(),
    stopPoolMonitor: jest.fn(),
    pool: { end: jest.fn() },
}));
jest.mock('../../repositories/layer-job.repository', () => ({}));
jest.mock('../../repositories/layer.repository', () => ({}));
jest.mock('../file-cleanup.worker', () => ({}));
jest.mock('../../utils/geoserver.client', () => {
    class GeoServerError extends Error {
        constructor(message, status) {
            super(message);
            this.status = status;
        }
    }
    return { GeoServerError };
});
jest.mock('../../services/gdal-import.service', () => ({
    executeImport: jest.fn(),
    LayerImportValidationError: class LayerImportValidationError extends Error {},
    quoteIdentifier: jest.fn((value) => `"${value}"`),
}));

const db = require('../../configs/database');
const { GeoServerError } = require('../../utils/geoserver.client');
const worker = require('../layer-import.worker');

const job = { id: 4, layer_id: 9, attempt: 1, max_attempts: 5 };
const rasterLayer = {
    id: 9,
    code: 'forest_classification_202501',
    object_key: 'raster/2025/01/forest/latest.tif',
    storage_kind: 'geotiff_minio',
    geoserver_layer: 'campha:forest_classification_202501',
    metadata: { geoserverStore: 'forest_classification_202501' },
};

const makeDeps = (layer = rasterLayer) => ({
    jobRepository: {
        heartbeatCleanup: jest.fn().mockResolvedValue(true),
        completeCleanup: jest.fn().mockResolvedValue(true),
        failCleanup: jest.fn().mockResolvedValue(true),
    },
    layerRepository: {
        findById: jest.fn().mockResolvedValue(layer),
        findRasterIngestArtifact: jest.fn().mockResolvedValue({
            geoserverPublishCategory: 'raster',
        }),
    },
    geoserverClient: {
        unpublishLayer: jest.fn().mockResolvedValue(undefined),
        deleteCoverageStore: jest.fn().mockResolvedValue(undefined),
    },
    removeGeoServerMirror: jest.fn().mockResolvedValue(true),
});

describe('layer import cleanup worker', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('removes dedicated GeoServer raster catalog and verified filesystem mirror', async () => {
        const deps = makeDeps();

        await worker.processCleanup(job, deps);

        expect(deps.geoserverClient.unpublishLayer).toHaveBeenCalledWith(
            'campha:forest_classification_202501',
        );
        expect(deps.geoserverClient.deleteCoverageStore).toHaveBeenCalledWith(
            'forest_classification_202501',
        );
        expect(deps.layerRepository.findRasterIngestArtifact).toHaveBeenCalledWith(rasterLayer);
        expect(deps.removeGeoServerMirror).toHaveBeenCalledWith(
            'forest_classification_202501',
            'raster',
        );
        expect(deps.jobRepository.completeCleanup).toHaveBeenCalledWith(
            job.id,
            expect.any(String),
            job.layer_id,
        );
        expect(deps.jobRepository.failCleanup).not.toHaveBeenCalled();
    });

    test('keeps remote-sensing source and skips filesystem mirror', async () => {
        const deps = makeDeps({
            ...rasterLayer,
            source_file_id: 32,
            metadata: {},
        });
        deps.layerRepository.findRasterIngestArtifact.mockResolvedValue(null);

        await worker.processCleanup(job, deps);

        expect(deps.geoserverClient.deleteCoverageStore).toHaveBeenCalledWith(
            'forest_classification_202501',
        );
        expect(deps.removeGeoServerMirror).not.toHaveBeenCalled();
        expect(deps.jobRepository.completeCleanup).toHaveBeenCalled();
    });

    test('treats GeoServer 404 as idempotent success', async () => {
        const deps = makeDeps();
        deps.geoserverClient.unpublishLayer.mockRejectedValue(new GeoServerError('not found', 404));
        deps.geoserverClient.deleteCoverageStore.mockRejectedValue(
            new GeoServerError('not found', 404),
        );

        await worker.processCleanup(job, deps);

        expect(deps.jobRepository.completeCleanup).toHaveBeenCalled();
        expect(deps.jobRepository.failCleanup).not.toHaveBeenCalled();
    });

    test('retries a real GeoServer failure', async () => {
        const deps = makeDeps();
        deps.geoserverClient.deleteCoverageStore.mockRejectedValue(
            new Error('GeoServer unavailable'),
        );

        await worker.processCleanup(job, deps);

        expect(deps.jobRepository.completeCleanup).not.toHaveBeenCalled();
        expect(deps.jobRepository.failCleanup).toHaveBeenCalledWith(
            job,
            expect.any(String),
            'GeoServer unavailable',
        );
    });

    test('keeps PostGIS cleanup behavior and does not delete a CoverageStore', async () => {
        const deps = makeDeps({
            id: 9,
            storage_kind: 'postgis',
            table_name: 'roads_2025',
            geoserver_layer: 'campha:roads_2025',
            metadata: {},
        });

        await worker.processCleanup(job, deps);

        expect(deps.geoserverClient.deleteCoverageStore).not.toHaveBeenCalled();
        expect(deps.layerRepository.findRasterIngestArtifact).not.toHaveBeenCalled();
        expect(db.query).toHaveBeenCalledWith('DROP TABLE IF EXISTS gis."roads_2025"');
        expect(deps.jobRepository.completeCleanup).toHaveBeenCalled();
    });

    test('keeps an unknown raster CoverageStore untouched', async () => {
        const deps = makeDeps({
            ...rasterLayer,
            metadata: { geoserverStore: 'forest_classification_202501' },
        });
        deps.layerRepository.findRasterIngestArtifact.mockResolvedValue(null);

        await worker.processCleanup(job, deps);

        expect(deps.geoserverClient.deleteCoverageStore).not.toHaveBeenCalled();
        expect(deps.removeGeoServerMirror).not.toHaveBeenCalled();
        expect(deps.jobRepository.completeCleanup).toHaveBeenCalled();
    });

    test('only derives stores from a safe name', () => {
        expect(
            worker.coverageStoreForLayer({
                metadata: { geoserverStore: '../../outside' },
                geoserver_layer: 'campha:valid_store',
            }),
        ).toBeNull();
        expect(worker.coverageStoreForLayer({ geoserver_layer: 'campha:valid_store' })).toBe(
            'valid_store',
        );
        expect(worker.coverageStoreForLayer({ geoserver_layer: 'campha:one:two' })).toBeNull();
    });

    test('rejects a symbolic-link mirror category', async () => {
        const previousDataDir = process.env.GEOSERVER_DATA_DIR;
        process.env.GEOSERVER_DATA_DIR = 'C:/geoserver';
        try {
            await expect(
                worker.removeGeoServerMirror('forest_classification_202501', 'raster', {
                    fsPromises: {
                        realpath: jest.fn().mockResolvedValue('C:/geoserver'),
                        lstat: jest.fn().mockResolvedValue({
                            isDirectory: () => true,
                            isSymbolicLink: () => true,
                        }),
                        rm: jest.fn(),
                    },
                    path: require('path').win32,
                }),
            ).rejects.toThrow('not a real directory');
        } finally {
            if (previousDataDir === undefined) {
                delete process.env.GEOSERVER_DATA_DIR;
            } else {
                process.env.GEOSERVER_DATA_DIR = previousDataDir;
            }
        }
    });
});
