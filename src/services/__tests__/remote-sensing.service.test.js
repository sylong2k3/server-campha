'use strict';
jest.mock('../../repositories/remote-sensing.repository');
jest.mock('../minio.service', () => ({ getPresignedDownloadUrl: jest.fn() }));
jest.mock('../../utils/systemLogger.util', () => ({ logInfo: jest.fn() }));
const repository = require('../../repositories/remote-sensing.repository');
const minio = require('../minio.service');
const service = require('../remote-sensing.service');
const admin = {
    id: 2,
    role: 'so_tnmt',
    orgId: 1,
    permissions: {
        raster: { read: true, create: true, delete: true, categorize: true, download: true },
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
        await expect(service.remove(1, new Date(), admin)).rejects.toMatchObject({ status: 404 });
    });
});
