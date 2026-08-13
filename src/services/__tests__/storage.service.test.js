'use strict';

process.env.JWT_SECRET ||= 'test-download-ticket-secret-at-least-32-characters';

jest.mock('../../configs/minioClient', () => ({
    getBucketForCategory: jest.fn(() => 'campha-documents'),
}));
jest.mock('../minio.service', () => ({
    buildObjectKey: jest.fn(() => 'documents/2026/07/id/report.pdf'),
    uploadStream: jest.fn(),
    getPresignedUploadUrl: jest.fn(),
    statQuarantineObject: jest.fn(),
    getQuarantineHead: jest.fn(),
    getQuarantineStream: jest.fn(),
    promoteQuarantineObject: jest.fn(),
    removeQuarantineObject: jest.fn(),
    removeObject: jest.fn(),
    getPresignedDownloadUrl: jest.fn(),
    getObjectStream: jest.fn(),
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
    markMissingObject: jest.fn(),
    resetPending: jest.fn(),
    findAccessibleById: jest.fn(),
    findById: jest.fn(),
    findPublicById: jest.fn(),
    enqueueDelete: jest.fn(),
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
        minio.uploadStream.mockResolvedValue({ etag: 'uploaded-etag' });
        minio.removeQuarantineObject.mockResolvedValue(undefined);
        minio.removeObject.mockResolvedValue(undefined);
        minio.promoteQuarantineObject.mockResolvedValue(undefined);
        repo.markRejected.mockResolvedValue({ id: 11, lifecycle_status: 'rejected' });
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
        repo.enqueueDelete.mockResolvedValue({
            id: 11,
            fileCleanupQueued: true,
            fileObjectIds: [11],
        });
        await expect(service.deleteObject(11, actor)).resolves.toEqual({
            id: 11,
            fileCleanupQueued: true,
            fileObjectIds: [11],
        });
        expect(minio.removeObject).not.toHaveBeenCalled();
        repo.enqueueDelete.mockResolvedValue({
            conflict: 'FILE_STILL_IN_USE',
            references: ['cms_document'],
        });
        await expect(service.deleteObject(11, actor)).rejects.toMatchObject({
            status: 409,
            errors: ['FILE_STILL_IN_USE', 'cms_document'],
        });
    });
    test('stream without ticket uses owner lookup or a public DB reference', async () => {
        repo.findAccessibleById.mockResolvedValue(null);
        await expect(service.streamFile(11, null, actor)).rejects.toMatchObject({ status: 404 });
        expect(repo.findAccessibleById).toHaveBeenCalledWith(11, actor.id);
        expect(repo.findById).not.toHaveBeenCalled();

        repo.findPublicById.mockResolvedValue({
            id: 11,
            lifecycle_status: 'ready',
            scan_status: 'clean',
            object_key: 'field-photos/photo.png',
            category: 'field-photos',
            detected_mime: 'image/png',
            size_bytes: 5,
            original_name: 'photo.png',
        });
        minio.getObjectStream.mockResolvedValue(stream('photo'));
        await expect(service.streamFile(11, null, null)).resolves.toMatchObject({
            access: 'public',
            mimeType: 'image/png',
        });
        expect(repo.findPublicById).toHaveBeenCalledWith(11);
    });
    test('valid ticket streams its bound ready object and invalid ticket is rejected', async () => {
        const jwt = require('jsonwebtoken');
        const ticket = jwt.sign(
            { fileObjectId: 11, purpose: 'file_download' },
            process.env.JWT_SECRET,
            { expiresIn: '60s' },
        );
        repo.findById.mockResolvedValue({
            id: 11,
            lifecycle_status: 'ready',
            scan_status: 'clean',
            object_key: 'o',
            category: 'documents',
            detected_mime: 'application/pdf',
            size_bytes: 5,
            original_name: 'report.pdf',
        });
        minio.getObjectStream.mockResolvedValue(stream('%PDF'));
        await expect(service.streamFile(11, ticket, null)).resolves.toMatchObject({
            mimeType: 'application/pdf',
            sizeBytes: 5,
            originalName: 'report.pdf',
        });
        expect(repo.findById).toHaveBeenCalledWith(11);
        await expect(service.streamFile(12, ticket, null)).rejects.toMatchObject({ status: 403 });
        await expect(service.streamFile(11, 'broken', null)).rejects.toMatchObject({ status: 403 });
    });
    test('returns a safe 404 when ready metadata points to a missing MinIO object', async () => {
        repo.findPublicById.mockResolvedValue({
            id: 11,
            lifecycle_status: 'ready',
            scan_status: 'clean',
            object_key: 'seed/documents/missing.pdf',
            category: 'documents',
            detected_mime: 'application/pdf',
            size_bytes: 5,
            original_name: 'missing.pdf',
        });
        minio.getObjectStream.mockRejectedValue(
            Object.assign(new Error('The specified key does not exist.'), { code: 'NoSuchKey' }),
        );
        await expect(service.streamFile(11, null, null)).rejects.toMatchObject({
            status: 404,
            errors: ['FILE_OBJECT_MISSING'],
        });
        expect(repo.markMissingObject).toHaveBeenCalledWith(11);
    });
    test('expired ticket and non-ready object are rejected', async () => {
        const jwt = require('jsonwebtoken');
        const expiredTicket = jwt.sign(
            { fileObjectId: 11, purpose: 'file_download' },
            process.env.JWT_SECRET,
            { expiresIn: -1 },
        );
        await expect(service.streamFile(11, expiredTicket, null)).rejects.toMatchObject({
            status: 403,
        });
        expect(repo.findById).not.toHaveBeenCalled();

        const validTicket = jwt.sign(
            { fileObjectId: 11, purpose: 'file_download' },
            process.env.JWT_SECRET,
            { expiresIn: '60s' },
        );
        repo.findById.mockResolvedValue({ id: 11, lifecycle_status: 'pending' });
        await expect(service.streamFile(11, validTicket, null)).rejects.toMatchObject({
            status: 404,
        });
        expect(minio.getObjectStream).not.toHaveBeenCalled();
    });
    test('direct upload streams to quarantine, scans and returns ready object', async () => {
        const requestStream = stream('II*\0clean-raster');
        repo.createQuarantine.mockResolvedValue({
            ...pending(),
            quarantine_key: 'quarantine/7/file.tif',
        });
        repo.claimForScan.mockResolvedValue({
            ...pending(),
            category: 'raster',
            original_name: 'file.tif',
            quarantine_key: 'quarantine/7/file.tif',
            object_key: 'raster/file.tif',
        });
        minio.statQuarantineObject.mockResolvedValue({ size: 16, etag: 'uploaded-etag' });
        minio.getQuarantineHead.mockResolvedValue(Buffer.from('49492a00', 'hex'));
        minio.getQuarantineStream
            .mockResolvedValueOnce(stream('clean'))
            .mockResolvedValueOnce(stream('1234567890123456'));
        clamav.scanStream.mockResolvedValue({ clean: true });
        repo.markReady.mockResolvedValue({
            id: 11,
            lifecycle_status: 'ready',
            scan_status: 'clean',
        });

        await expect(
            service.directUpload(
                {
                    stream: requestStream,
                    category: 'raster',
                    originalName: 'file.tif',
                    contentType: 'image/tiff',
                    contentLength: 16,
                },
                { id: 7, orgId: 2, permissions: { raster: { create: true } } },
            ),
        ).resolves.toMatchObject({ lifecycle_status: 'ready', scan_status: 'clean' });
        expect(minio.uploadStream).toHaveBeenCalledWith(
            expect.objectContaining({
                stream: requestStream,
                fileSize: 16,
                quarantine: true,
            }),
        );
        expect(minio.promoteQuarantineObject).toHaveBeenCalled();
    });
    test('direct upload rejects oversized content before allocation', async () => {
        await expect(
            service.directUpload(
                {
                    stream: stream(),
                    category: 'documents',
                    originalName: 'report.pdf',
                    contentType: 'application/pdf',
                    contentLength: service.MAX_BYTES.documents + 1,
                },
                actor,
            ),
        ).rejects.toMatchObject({ status: 413 });
        expect(repo.createQuarantine).not.toHaveBeenCalled();
        expect(minio.uploadStream).not.toHaveBeenCalled();
    });
    test('direct document upload uses MinIO and cleans allocation when stream fails', async () => {
        repo.createQuarantine.mockResolvedValue({
            ...pending(),
            quarantine_key: 'quarantine/7/report.pdf',
        });
        minio.uploadStream.mockRejectedValue(new Error('client aborted'));
        await expect(
            service.directUpload(
                {
                    stream: stream(),
                    category: 'documents',
                    originalName: 'report.pdf',
                    contentType: 'application/pdf',
                    contentLength: 5,
                },
                actor,
            ),
        ).rejects.toThrow('client aborted');
        expect(minio.uploadStream).toHaveBeenCalledWith(
            expect.objectContaining({ category: 'documents', quarantine: true }),
        );
        expect(repo.markRejected).toHaveBeenCalledWith(11, 'error');
        expect(minio.removeQuarantineObject).toHaveBeenCalledWith(
            expect.stringMatching(/^quarantine\/7\/[0-9a-f-]+\/report\.pdf$/),
        );
    });
    test('direct upload keeps quarantine pending when ClamAV is unavailable', async () => {
        repo.createQuarantine.mockResolvedValue({
            ...pending(),
            quarantine_key: 'quarantine/7/file.tif',
        });
        repo.claimForScan.mockResolvedValue({
            ...pending(),
            category: 'raster',
            original_name: 'file.tif',
            quarantine_key: 'quarantine/7/file.tif',
            object_key: 'raster/file.tif',
        });
        minio.statQuarantineObject.mockResolvedValue({ size: 4, etag: 'uploaded-etag' });
        minio.getQuarantineHead.mockResolvedValue(Buffer.from('49492a00', 'hex'));
        minio.getQuarantineStream.mockResolvedValue(stream('clean'));
        clamav.scanStream.mockRejectedValue(new clamav.ClamAvUnavailableError());

        await expect(
            service.directUpload(
                {
                    stream: stream('II*\0'),
                    category: 'raster',
                    originalName: 'file.tif',
                    contentType: 'image/tiff',
                    contentLength: 4,
                },
                { id: 7, orgId: 2, permissions: { raster: { create: true } } },
            ),
        ).rejects.toMatchObject({ status: 503 });
        expect(repo.resetPending).toHaveBeenCalledWith(11);
        expect(repo.markRejected).not.toHaveBeenCalled();
        expect(minio.removeQuarantineObject).not.toHaveBeenCalled();
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
