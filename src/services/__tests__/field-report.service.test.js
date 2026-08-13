'use strict';
jest.mock('../../repositories/field-report.repository');
jest.mock('../../repositories/device-token.repository');
jest.mock('../../services/minio.service', () => ({
    getPublicFileUrl: jest.fn(),
    getPresignedDownloadUrl: jest.fn(),
}));
jest.mock('../../utils/systemLogger.util', () => ({ logInfo: jest.fn() }));
const repo = require('../../repositories/field-report.repository');
const minio = require('../../services/minio.service');
const service = require('../field-report.service');
const citizen = {
    id: 1,
    role: 'citizen',
    lang: 'vi',
    permissions: { field_report: { create: true, measure: true } },
};
describe('Sprint 8 field report RBAC service', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        minio.getPublicFileUrl.mockReturnValue({ url: 'public-photo', expiresAt: null });
        minio.getPresignedDownloadUrl.mockResolvedValue({ url: 'ticket-photo', expiresAt: new Date() });
    });
    test('citizen creates but cannot list admin', async () => {
        repo.create.mockResolvedValue({ id: 9 });
        await expect(service.create({ photoIds: [] }, citizen)).resolves.toMatchObject({ id: 9 });
        expect(() => service.listAdmin({}, citizen)).toThrow(
            expect.objectContaining({ status: 403 }),
        );
    });
    test.each(['system_admin', 'citizen'])('%s cannot review', async (role) => {
        const actor = { ...citizen, role, permissions: { field_report: { approve: true } } };
        await expect(service.review(1, {}, actor)).rejects.toMatchObject({ status: 403 });
    });
    test.each(['ubnd_tp', 'so_tnmt', 'so_xd'])('%s can review', async (role) => {
        const actor = { ...citizen, role, permissions: { field_report: { approve: true } } };
        repo.review.mockResolvedValue({ id: 1, status: 'approved' });
        await expect(service.review(1, { status: 'approved' }, actor)).resolves.toMatchObject({
            status: 'approved',
        });
    });
    test('public photos use stable API URLs and private photos use file-bound tickets', async () => {
        const report = { id: 9, status: 'approved' };
        const photo = {
            id: 32,
            object_key: 'field-photos/photo.png',
            original_name: 'photo.png',
            size_bytes: 123,
        };
        repo.find.mockResolvedValue(report);
        repo.photoObjects.mockResolvedValue([photo]);
        await expect(service.getPublic(9)).resolves.toMatchObject({
            photos: [{ id: 32, url: 'public-photo', expiresAt: null }],
        });
        expect(repo.find).toHaveBeenCalledWith(9, 'public');
        expect(minio.getPublicFileUrl).toHaveBeenCalledWith(32);

        repo.find.mockResolvedValue({ ...report, status: 'pending' });
        repo.history.mockResolvedValue([]);
        await expect(service.get(9, citizen)).resolves.toMatchObject({
            photos: [{ id: 32, url: 'ticket-photo' }],
        });
        expect(minio.getPresignedDownloadUrl).toHaveBeenCalledWith({
            objectKey: 'field-photos/photo.png',
            category: 'field-photos',
            expireSeconds: 300,
            fileId: 32,
        });
    });
    test('queues photo cleanup and rejects active references', async () => {
        repo.remove.mockResolvedValue({
            id: 1,
            fileCleanupQueued: true,
            fileObjectIds: [8, 9],
        });
        await expect(service.remove(1, new Date(), true, citizen)).resolves.toMatchObject({
            fileObjectIds: [8, 9],
        });
        expect(repo.remove).toHaveBeenCalledWith(1, expect.any(Date), citizen, true);
        repo.remove.mockResolvedValue({
            conflict: 'FILE_STILL_IN_USE',
            references: ['field_report'],
        });
        await expect(service.remove(1, new Date(), true, citizen)).rejects.toMatchObject({
            status: 409,
            errors: ['FILE_STILL_IN_USE', 'field_report'],
        });
    });
});
