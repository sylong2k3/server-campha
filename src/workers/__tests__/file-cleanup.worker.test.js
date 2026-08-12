'use strict';

jest.mock('../../repositories/file-cleanup.repository', () => ({
    activeReferences: jest.fn(),
    block: jest.fn(),
    findFile: jest.fn(),
    complete: jest.fn(),
    fail: jest.fn(),
    heartbeat: jest.fn(),
    claim: jest.fn(),
}));
jest.mock('../../services/minio.service', () => ({ removeObject: jest.fn() }));

const repository = require('../../repositories/file-cleanup.repository');
const minio = require('../../services/minio.service');
const worker = require('../file-cleanup.worker');

const job = { id: 1, file_object_id: 32, attempt: 1, max_attempts: 8 };

describe('file cleanup worker', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        repository.activeReferences.mockResolvedValue([]);
        repository.findFile.mockResolvedValue({
            id: 32,
            category: 'raster',
            object_key: 'raster/file.tif',
            lifecycle_status: 'ready',
            deleted_at: null,
        });
        repository.complete.mockResolvedValue({
            completed: true,
            leaseLost: false,
            references: [],
        });
        minio.removeObject.mockResolvedValue(undefined);
    });

    test('deletes from the recorded category then marks cleanup complete', async () => {
        await expect(worker.processJob(job)).resolves.toEqual({ completed: true });
        expect(minio.removeObject).toHaveBeenCalledWith({
            objectKey: 'raster/file.tif',
            category: 'raster',
        });
        expect(repository.complete).toHaveBeenCalledWith(job, worker.workerId);
        expect(repository.fail).not.toHaveBeenCalled();
    });

    test('blocks without touching MinIO when file is still referenced', async () => {
        repository.activeReferences.mockResolvedValue(['layer']);
        repository.block.mockResolvedValue(true);
        await expect(worker.processJob(job)).resolves.toEqual({
            completed: false,
            blockedBy: ['layer'],
        });
        expect(repository.block).toHaveBeenCalledWith(job, worker.workerId, ['layer']);
        expect(minio.removeObject).not.toHaveBeenCalled();
    });

    test('reports blocked when a reference appears during final DB completion', async () => {
        repository.complete.mockResolvedValue({
            completed: false,
            leaseLost: false,
            references: ['layer'],
        });
        await expect(worker.processJob(job)).resolves.toEqual({
            completed: false,
            blockedBy: ['layer'],
        });
        expect(minio.removeObject).toHaveBeenCalled();
        expect(repository.fail).not.toHaveBeenCalled();
    });

    test('retries MinIO failures without marking the DB file deleted', async () => {
        const error = Object.assign(new Error('MinIO unavailable'), { code: 'ECONNREFUSED' });
        minio.removeObject.mockRejectedValue(error);
        await expect(worker.processJob(job)).resolves.toMatchObject({ completed: false, error });
        expect(repository.fail).toHaveBeenCalledWith(job, worker.workerId, error);
        expect(repository.complete).not.toHaveBeenCalled();
    });

    test('treats a missing object as idempotent success', async () => {
        minio.removeObject.mockRejectedValue(
            Object.assign(new Error('gone'), { code: 'NoSuchKey' }),
        );
        await expect(worker.processJob(job)).resolves.toEqual({ completed: true });
        expect(repository.complete).toHaveBeenCalled();
    });
});
