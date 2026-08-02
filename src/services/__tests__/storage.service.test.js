'use strict';

jest.mock('../../configs/minioClient', () => ({
    getBucketForCategory: jest.fn(() => 'campha-documents'),
}));
jest.mock('../minio.service', () => ({
    buildObjectKey: jest.fn(() => 'documents/2026/07/id/report.pdf'),
    getPresignedUploadUrl: jest.fn(),
    statQuarantineObject: jest.fn(),
    getQuarantineHead: jest.fn(),
    getQuarantineStream: jest.fn(),
    promoteQuarantineObject: jest.fn(),
    removeQuarantineObject: jest.fn(),
    removeObject: jest.fn(),
    getPresignedDownloadUrl: jest.fn(),
}));
jest.mock('../clamav.service', () => {
    class ClamAvUnavailableError extends Error {}
    class MalwareDetectedError extends Error {}
    return { scanStream: jest.fn(), ClamAvUnavailableError, MalwareDetectedError };
});
jest.mock('../../repositories/storage.repository', () => ({
    createQuarantine: jest.fn(),
    claimForScan: jest.fn(),
    markReady: jest.fn(),
    markRejected: jest.fn(),
    resetPending: jest.fn(),
    findAccessibleById: jest.fn(),
    markDeleted: jest.fn(),
}));
const { Readable } = require('stream');
const minio = require('../minio.service');
const clamav = require('../clamav.service');
const repo = require('../../repositories/storage.repository');
const service = require('../storage.service');
const actor = { id: 7, orgId: 2, permissions: { documents: { create: true } } };
const pending = () => ({
    id: 11,
    category: 'documents',
    original_name: 'report.pdf',
    quarantine_key: 'q',
    object_key: 'o',
});
const stream = (value = 'clean') => Readable.from([Buffer.from(value)]);
describe('storage quarantine workflow', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        minio.removeQuarantineObject.mockResolvedValue(undefined);
        minio.removeObject.mockResolvedValue(undefined);
        minio.promoteQuarantineObject.mockResolvedValue(undefined);
    });
    test('presign records owner and never accepts arbitrary bucket', async () => {
        minio.getPresignedUploadUrl.mockResolvedValue({
            url: 'signed',
            expiresAt: new Date('2026-08-01'),
        });
        repo.createQuarantine.mockResolvedValue({ id: 11 });
        await expect(
            service.createPresignedUpload(
                {
                    category: 'documents',
                    originalName: 'report.pdf',
                    contentType: 'application/pdf',
                    expireSeconds: 900,
                },
                actor,
            ),
        ).resolves.toMatchObject({ id: 11, uploadUrl: 'signed' });
        expect(repo.createQuarantine).toHaveBeenCalledWith(
            expect.objectContaining({ bucket: 'campha-documents', ownerUserId: 7 }),
        );
    });
    test('scanner outage resets pending and returns 503 without promote', async () => {
        repo.claimForScan.mockResolvedValue({
            id: 11,
            category: 'documents',
            original_name: 'report.pdf',
            quarantine_key: 'q',
            object_key: 'o',
        });
        minio.statQuarantineObject.mockResolvedValue({ size: 8 });
        minio.getQuarantineHead.mockResolvedValue(Buffer.from('%PDF-x'));
        minio.getQuarantineStream.mockResolvedValue(Readable.from('clean'));
        clamav.scanStream.mockRejectedValue(new clamav.ClamAvUnavailableError());
        await expect(service.commitUpload(11, actor)).rejects.toMatchObject({ status: 503 });
        expect(repo.resetPending).toHaveBeenCalledWith(11);
        expect(minio.promoteQuarantineObject).not.toHaveBeenCalled();
    });
    test('rejects unauthorized category and extension before presigning', async () => {
        await expect(
            service.createPresignedUpload(
                { category: 'documents', originalName: 'a.pdf', contentType: 'application/pdf' },
                { id: 8, permissions: {} },
            ),
        ).rejects.toMatchObject({ status: 403 });
        await expect(
            service.createPresignedUpload(
                {
                    category: 'documents',
                    originalName: 'a.exe',
                    contentType: 'application/octet-stream',
                },
                actor,
            ),
        ).rejects.toMatchObject({ status: 422 });
        expect(minio.getPresignedUploadUrl).not.toHaveBeenCalled();
    });
    test('removes quarantine allocation when metadata insert fails', async () => {
        minio.getPresignedUploadUrl.mockResolvedValue({
            url: 'signed',
            expiresAt: new Date('2026-08-01'),
        });
        repo.createQuarantine.mockRejectedValue(new Error('db failed'));
        await expect(
            service.createPresignedUpload(
                { category: 'documents', originalName: 'a.pdf', contentType: 'application/pdf' },
                actor,
            ),
        ).rejects.toThrow('db failed');
        expect(minio.removeQuarantineObject).toHaveBeenCalled();
    });
    test('clean commit hashes, promotes, marks ready and removes quarantine', async () => {
        repo.claimForScan.mockResolvedValue(pending());
        minio.statQuarantineObject.mockResolvedValue({ size: 5, etag: 'scanned-etag' });
        minio.getQuarantineHead.mockResolvedValue(Buffer.from('%PDF-x'));
        minio.getQuarantineStream.mockResolvedValueOnce(stream()).mockResolvedValueOnce(stream());
        clamav.scanStream.mockResolvedValue({ clean: true });
        repo.markReady.mockResolvedValue({ id: 11, lifecycle_status: 'ready' });
        await expect(service.commitUpload(11, actor)).resolves.toMatchObject({
            lifecycle_status: 'ready',
        });
        expect(minio.promoteQuarantineObject).toHaveBeenCalledWith({
            quarantineKey: 'q',
            objectKey: 'o',
            category: 'documents',
            sourceEtag: 'scanned-etag',
        });
        expect(repo.markReady).toHaveBeenCalledWith(
            11,
            expect.objectContaining({ sizeBytes: 5, detectedMime: 'application/pdf' }),
        );
    });
    test('missing pending claim returns conflict', async () => {
        repo.claimForScan.mockResolvedValue(null);
        await expect(service.commitUpload(11, actor)).rejects.toMatchObject({ status: 409 });
    });
    test('oversized upload is rejected before scan', async () => {
        repo.claimForScan.mockResolvedValue(pending());
        minio.statQuarantineObject.mockResolvedValue({ size: service.MAX_BYTES.documents + 1 });
        await expect(service.commitUpload(11, actor)).rejects.toMatchObject({ status: 413 });
        expect(repo.markRejected).toHaveBeenCalledWith(11, 'error');
    });
    test('malware is rejected and quarantine removed', async () => {
        repo.claimForScan.mockResolvedValue(pending());
        minio.statQuarantineObject.mockResolvedValue({ size: 5 });
        minio.getQuarantineHead.mockResolvedValue(Buffer.from('%PDF-x'));
        minio.getQuarantineStream.mockResolvedValue(stream());
        clamav.scanStream.mockRejectedValue(new clamav.MalwareDetectedError('Eicar'));
        await expect(service.commitUpload(11, actor)).rejects.toMatchObject({ status: 422 });
        expect(repo.markRejected).toHaveBeenCalledWith(11, 'infected');
    });
    test('changed object size is rejected after scan', async () => {
        repo.claimForScan.mockResolvedValue(pending());
        minio.statQuarantineObject.mockResolvedValue({ size: 99 });
        minio.getQuarantineHead.mockResolvedValue(Buffer.from('%PDF-x'));
        minio.getQuarantineStream.mockResolvedValueOnce(stream()).mockResolvedValueOnce(stream());
        clamav.scanStream.mockResolvedValue({ clean: true });
        await expect(service.commitUpload(11, actor)).rejects.toMatchObject({ status: 409 });
        expect(repo.markRejected).toHaveBeenCalledWith(11, 'error');
    });
    test('download and delete require ready owner object', async () => {
        repo.findAccessibleById.mockResolvedValueOnce(null);
        await expect(service.getDownloadUrl(11, 900, actor)).rejects.toMatchObject({ status: 404 });
        repo.findAccessibleById.mockResolvedValue({
            id: 11,
            lifecycle_status: 'ready',
            object_key: 'o',
            category: 'documents',
        });
        minio.getPresignedDownloadUrl.mockResolvedValue({ url: 'download' });
        await expect(service.getDownloadUrl(11, 900, actor)).resolves.toEqual({ url: 'download' });
        repo.markDeleted.mockResolvedValue({ id: 11 });
        await expect(service.deleteObject(11, actor)).resolves.toEqual({ id: 11 });
        expect(minio.removeObject).toHaveBeenCalledWith({ objectKey: 'o', category: 'documents' });
    });
    test('signature mismatch rejects and deletes quarantine object', async () => {
        repo.claimForScan.mockResolvedValue({
            id: 11,
            category: 'documents',
            original_name: 'report.pdf',
            quarantine_key: 'q',
            object_key: 'o',
        });
        minio.statQuarantineObject.mockResolvedValue({ size: 8 });
        minio.getQuarantineHead.mockResolvedValue(Buffer.from('MZ bad'));
        await expect(service.commitUpload(11, actor)).rejects.toMatchObject({ status: 422 });
        expect(repo.markRejected).toHaveBeenCalledWith(11, 'error');
        expect(minio.removeQuarantineObject).toHaveBeenCalledWith('q');
    });
});
