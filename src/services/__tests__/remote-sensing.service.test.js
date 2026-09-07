'use strict';
jest.mock('../../repositories/remote-sensing.repository');
jest.mock('../../repositories/web-map.repository', () => ({ invalidateLayerCache: jest.fn() }));
jest.mock('../minio.service', () => ({
    getPresignedDownloadUrl: jest.fn(),
    getObjectStream: jest.fn(),
}));
jest.mock('../../utils/geoserver.client', () => ({
    publishGeoTiffStream: jest.fn(),
    uploadImageMosaicZip: jest.fn(),
    configureCoverageTime: jest.fn(),
    verifyImageMosaicTime: jest.fn(),
}));
jest.mock('../geotiff-time-series.service', () => ({ materializeImageMosaic: jest.fn() }));
jest.mock('../../utils/systemLogger.util', () => ({ logInfo: jest.fn() }));
const repository = require('../../repositories/remote-sensing.repository');
const webMapRepository = require('../../repositories/web-map.repository');
const geoserver = require('../../utils/geoserver.client');
const minio = require('../minio.service');
const service = require('../remote-sensing.service');
const timeSeriesService = require('../geotiff-time-series.service');
const logger = require('../../utils/systemLogger.util');
const admin = {
    id: 2,
    role: 'so_tnmt',
    orgId: 1,
    permissions: {
        raster: { read: true, create: true, delete: true, categorize: true, download: true },
        layers: { create: true },
    },
};
const citizen = {
    id: 3,
    role: 'citizen',
    permissions: { raster: { search: true, compare: true, download: true } },
};
const before = { id: 1, coverage_key: 'cp-1', acquired_at: '2025-01-01', object_key: 'before.tif' };
const after = { id: 2, coverage_key: 'cp-1', acquired_at: '2026-01-01', object_key: 'after.tif' };
describe('remote sensing service', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        minio.getPresignedDownloadUrl.mockResolvedValue({ url: 'signed', expiresAt: new Date() });
        minio.getObjectStream.mockResolvedValue({ pipe: jest.fn() });
    });
    test('delegates public catalog and hides object key from compare', async () => {
        repository.list.mockResolvedValue({ items: [], total: 0 });
        expect(await service.list({})).toEqual({ items: [], total: 0 });
        repository.find.mockImplementation((id) => Promise.resolve(id === 1 ? before : after));
        const result = await service.compare(1, 2, 'vi');
        expect(result.before.object_key).toBeUndefined();
        expect(minio.getPresignedDownloadUrl).toHaveBeenCalledWith(
            expect.objectContaining({ expireSeconds: 60 }),
        );
    });
    test('enforces raster:read permission on listAdmin and listCollections', async () => {
        repository.listAdmin.mockResolvedValue({ items: [{ id: 1 }], total: 1 });
        repository.listCollections.mockResolvedValue({ items: [{ coverageKey: 'test' }], total: 1 });

        await expect(service.listAdmin({ page: 1 }, admin)).resolves.toEqual({ items: [{ id: 1 }], total: 1 });
        await expect(service.listCollections({ page: 1 }, admin)).resolves.toEqual({ items: [{ coverageKey: 'test' }], total: 1 });

        const unprivileged = { id: 4, role: 'citizen', permissions: { raster: { read: false } } };
        await expect(service.listAdmin({ page: 1 }, unprivileged)).rejects.toMatchObject({ status: 403 });
        await expect(service.listCollections({ page: 1 }, unprivileged)).rejects.toMatchObject({ status: 403 });
    });
    test.each(['all', 'unpublished', 'standalone', 'time_series', 'in_use', 'cleanup_pending', 'cleanup_failed'])(
        'forwards admin status %s unchanged to repository', async (status) => {
            const filter = { status, page: 1, limit: 10 };
            const result = { items: [{ id: 1 }], total: 1 };
            repository.listAdmin.mockResolvedValue(result);
            await expect(service.listAdmin(filter, admin)).resolves.toBe(result);
            expect(repository.listAdmin).toHaveBeenCalledWith(filter);
        },
    );
    test('rejects compare coverage and temporal mismatches', async () => {
        repository.find.mockImplementation((id) =>
            Promise.resolve(id === 1 ? before : { ...after, coverage_key: 'other' }),
        );
        await expect(service.compare(1, 2, 'vi')).rejects.toMatchObject({ status: 422 });
        repository.find.mockImplementation((id) => Promise.resolve(id === 1 ? after : before));
        await expect(service.compare(1, 2, 'vi')).rejects.toMatchObject({ status: 422 });
    });
    test('enforces download and admin create permissions with locale', async () => {
        repository.find.mockResolvedValue(before);
        await expect(service.download(1, 300, citizen)).resolves.toMatchObject({ url: 'signed' });
        await expect(service.download(1, 300, { lang: 'en' })).rejects.toMatchObject({
            status: 403,
            message: 'You do not have permission to perform this satellite-image action',
        });
        repository.create.mockResolvedValue({ ...before, id: 3 });
        await expect(service.create({}, admin)).resolves.toMatchObject({ id: 3 });
        await expect(service.create({}, citizen)).rejects.toMatchObject({ status: 403 });
    });
    test('handles invalid file duplicate and optimistic conflicts', async () => {
        repository.create.mockResolvedValue(null);
        await expect(service.create({}, admin)).rejects.toMatchObject({ status: 422 });
        repository.create.mockRejectedValue({ code: '23505' });
        await expect(service.create({}, admin)).rejects.toMatchObject({ status: 409 });
        repository.categorize.mockResolvedValue(null);
        repository.find.mockResolvedValue(before);
        await expect(
            service.categorize(1, { thematicGroup: 'water', expectedUpdatedAt: new Date() }, admin),
        ).rejects.toMatchObject({ status: 409 });
        repository.find.mockResolvedValue(null);
        await expect(service.remove(1, new Date(), false, admin)).rejects.toMatchObject({
            status: 404,
        });
        repository.remove.mockResolvedValue({
            id: 1,
            fileCleanupQueued: true,
            fileObjectIds: [32],
        });
        await expect(service.remove(1, new Date(), true, admin)).resolves.toMatchObject({
            fileCleanupQueued: true,
            fileObjectIds: [32],
        });
        expect(repository.remove).toHaveBeenLastCalledWith(1, expect.any(Date), 2, true);
        repository.remove.mockResolvedValue({
            conflict: 'FILE_STILL_IN_USE',
            references: ['layer'],
        });
        await expect(service.remove(1, new Date(), true, admin)).rejects.toMatchObject({
            status: 409,
            errors: ['FILE_STILL_IN_USE', 'layer'],
        });
    });
    test('publishes a clean raster layer and invalidates Web Map cache', async () => {
        repository.preparePublish.mockResolvedValue({
            image: { id: 7, object_key: 'raster/2026/file.tif', size_bytes: '4096' },
            layer: { id: 9, code: 'lop_phu_2024', name_vi: 'Lớp phủ 2024' },
        });
        geoserver.publishGeoTiffStream.mockResolvedValue('campha:lop_phu_2024');
        repository.setPublishState.mockResolvedValue({ id: 9, publish_status: 'published' });
        await expect(service.publish(7, {}, admin)).resolves.toMatchObject({
            imageId: 7,
            geoserverLayer: 'campha:lop_phu_2024',
            layer: { publish_status: 'published' },
        });
        expect(minio.getObjectStream).toHaveBeenCalledWith({
            category: 'raster',
            objectKey: 'raster/2026/file.tif',
        });
        expect(geoserver.publishGeoTiffStream).toHaveBeenCalledWith({
            storeName: 'lop_phu_2024',
            stream: expect.objectContaining({ pipe: expect.any(Function) }),
            contentLength: 4096,
        });
        expect(webMapRepository.invalidateLayerCache).toHaveBeenCalledWith(9);
    });
    test('rejects publish without layer permission and records GeoServer failure', async () => {
        await expect(
            service.publish(7, {}, { ...admin, permissions: { raster: { create: true } } }),
        ).rejects.toMatchObject({ status: 403 });
        repository.preparePublish.mockResolvedValue({
            image: { id: 7, object_key: 'raster/file.tif', size_bytes: '2048' },
            layer: { id: 9, code: 'lop_phu_2024', name_vi: 'Lớp phủ 2024' },
        });
        geoserver.publishGeoTiffStream.mockRejectedValue(new Error('GeoServer failed'));
        repository.setPublishState.mockResolvedValue({ id: 9, publish_status: 'failed' });
        await expect(service.publish(7, {}, admin)).rejects.toThrow('GeoServer failed');
        expect(repository.setPublishState).toHaveBeenCalledWith(7, 9, 'failed');
    });
    test('maps missing raster and duplicate layer code to API errors', async () => {
        repository.preparePublish.mockResolvedValue(null);
        await expect(service.publish(99, {}, admin)).rejects.toMatchObject({ status: 404 });
        repository.preparePublish.mockRejectedValue({ code: '23505' });
        await expect(service.publish(7, {}, admin)).rejects.toMatchObject({ status: 409 });
    });

    test.each(Object.values(repository.PUBLISH_ERROR))(
        'returns %s with compatible codes before any remote publish',
        async (code) => {
            repository.preparePublish.mockRejectedValue(
                Object.assign(new Error('Safe domain error'), { code }),
            );
            repository.prepareCollectionPublish.mockRejectedValue(
                Object.assign(new Error('Safe domain error'), { code }),
            );
            await expect(service.publish(7, {}, admin)).rejects.toMatchObject({
                status: 409,
                errors: ['RASTER_LAYER_CONFLICT', code],
            });
            await expect(service.publishCollection('cp-1', {}, admin)).rejects.toMatchObject({
                status: 409,
                errors: ['COLLECTION_LAYER_CONFLICT', code],
            });
            expect(minio.getObjectStream).not.toHaveBeenCalled();
            expect(geoserver.publishGeoTiffStream).not.toHaveBeenCalled();
            expect(geoserver.uploadImageMosaicZip).not.toHaveBeenCalled();
            expect(repository.setPublishState).not.toHaveBeenCalled();
            expect(repository.setCollectionPublishState).not.toHaveBeenCalled();
        },
    );

    test('keeps raw SQL details out of unique-conflict responses and audit payloads', async () => {
        const failure = Object.assign(new Error('duplicate key value SQL internal secret'), {
            code: '23505',
            constraint: 'layers_code_key',
            detail: 'private detail',
        });
        repository.prepareCollectionPublish.mockRejectedValue(failure);
        repository.preparePublish.mockRejectedValue(failure);
        for (const attempt of [
            () => service.publish(7, {}, admin),
            () => service.publishCollection('cp-1', {}, admin),
        ]) {
            const error = await attempt().catch((error) => error);
            expect(error.status).toBe(409);
            expect(error.message).not.toContain('SQL internal secret');
        }
        expect(logger.logInfo).toHaveBeenCalledWith(
            'remote_sensing',
            'satellite_collection_publish_conflict',
            expect.objectContaining({ constraint: 'layers_code_key' }),
        );
        expect(JSON.stringify(logger.logInfo.mock.calls)).not.toContain('private detail');
    });

    test('publishes ordered collection values and selects the latest acquired timestamp', async () => {
        const values = ['2015-01-01T00:00:00.000Z', '2018-01-01T00:00:00.000Z'];
        repository.prepareCollectionPublish.mockResolvedValue({
            layer: { id: 172, code: 'cp_ts' },
            members: [
                { id: 99, file_object_id: 31 },
                { id: 7, file_object_id: 32 },
            ],
            values,
        });
        const cleanup = jest.fn().mockResolvedValue();
        timeSeriesService.materializeImageMosaic.mockResolvedValue({
            archivePath: 'test.zip',
            cleanup,
        });
        geoserver.uploadImageMosaicZip.mockResolvedValue('campha:cp_ts');
        repository.markCollectionStoreOwned.mockResolvedValue({ id: 172 });
        repository.setCollectionPublishState.mockResolvedValue({
            id: 172,
            publish_status: 'published',
        });
        await expect(service.publishCollection('cp-1', {}, admin)).resolves.toMatchObject({
            memberCount: 2,
            imageIds: [99, 7],
            timeSeries: { values, defaultTime: values[1] },
        });
        expect(geoserver.verifyImageMosaicTime).toHaveBeenCalledWith({ storeName: 'cp_ts' });
        expect(cleanup).toHaveBeenCalled();
    });

    test('updates coverage key and rejects duplicate or active collection members', async () => {
        repository.updateCoverageKey.mockResolvedValueOnce({ id: 1, coverage_key: 'new-key' });
        await expect(service.updateCoverageKey(1, 'new-key', admin)).resolves.toEqual({
            id: 1,
            coverage_key: 'new-key',
        });
        repository.updateCoverageKey.mockResolvedValueOnce({ conflict: 'TIME_SERIES_MEMBER' });
        await expect(service.updateCoverageKey(1, 'new-key', admin)).rejects.toMatchObject({
            status: 409,
            errors: ['TIME_SERIES_MEMBER'],
        });
        repository.updateCoverageKey.mockResolvedValueOnce({ conflict: 'CLEANUP_PENDING' });
        await expect(service.updateCoverageKey(1, 'new-key', admin)).rejects.toMatchObject({
            status: 409,
            errors: ['LAYER_CLEANUP_PENDING'],
        });
        repository.updateCoverageKey.mockResolvedValueOnce({ conflict: 'CLEANUP_REQUIRED' });
        await expect(service.updateCoverageKey(1, 'new-key', admin)).rejects.toMatchObject({
            status: 409,
            errors: ['LAYER_CLEANUP_REQUIRED'],
        });
    });

    test('merges collections and rejects duplicate times across source and target', async () => {
        repository.mergeCollections.mockResolvedValueOnce({ updatedCount: 2, targetCoverageKey: 'target-key' });
        await expect(service.mergeCollections(['src-1', 'src-2'], 'target-key', admin)).resolves.toEqual({
            updatedCount: 2,
            targetCoverageKey: 'target-key',
        });
        const err = new Error('duplicate');
        err.code = 'DUPLICATE_COLLECTION_TIME';
        repository.COLLECTION_ERROR = {
            DUPLICATE_TIME: 'DUPLICATE_COLLECTION_TIME',
            MEMBER_CONFLICT: 'COLLECTION_MEMBER_CONFLICT',
        };
        repository.mergeCollections.mockRejectedValueOnce(err);
        await expect(service.mergeCollections(['src-1'], 'target-key', admin)).rejects.toMatchObject({
            status: 409,
            errors: ['DUPLICATE_COLLECTION_TIME'],
        });
        const memberErr = new Error('member conflict');
        memberErr.code = 'COLLECTION_MEMBER_CONFLICT';
        repository.mergeCollections.mockRejectedValueOnce(memberErr);
        await expect(service.mergeCollections(['src-1'], 'target-key', admin)).rejects.toMatchObject({
            status: 409,
            errors: ['COLLECTION_MEMBER_CONFLICT'],
        });
    });
});

