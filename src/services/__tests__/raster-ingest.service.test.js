'use strict';

const { enqueue, runJob, getJobById, listJobsByLayer } = require('../raster-ingest.service');
const { Api404Error } = require('../../core/error.response');

describe('raster-ingest.service (facade)', () => {
    test('re-exports enqueue and runJob from the split modules', () => {
        expect(typeof enqueue).toBe('function');
        expect(typeof runJob).toBe('function');
    });

    describe('getJobById', () => {
        test('returns the job when the repo finds it', async () => {
            const repo = { findById: jest.fn().mockResolvedValue({ id: 7, status: 'completed' }) };
            const job = await getJobById(7, 'vi', { repo });
            expect(job).toEqual({ id: 7, status: 'completed' });
            expect(repo.findById).toHaveBeenCalledWith(7);
        });
        test('throws Api404Error when the repo returns null', async () => {
            const repo = { findById: jest.fn().mockResolvedValue(null) };
            await expect(getJobById(999, 'vi', { repo })).rejects.toBeInstanceOf(Api404Error);
        });
        test('throws when the repo module is not installed', async () => {
            await expect(getJobById(1, 'vi', { repo: null })).rejects.toThrow(
                /repository is not yet installed/,
            );
        });
    });

    describe('listJobsByLayer', () => {
        test('clamps limit to 1..100 and passes offset to the repo', async () => {
            const repo = { listByLayerCode: jest.fn().mockResolvedValue([]) };
            await listJobsByLayer('cp_flood_event', { page: 3, limit: 50 }, { repo });
            expect(repo.listByLayerCode).toHaveBeenCalledWith('cp_flood_event', {
                limit: 50,
                offset: 100,
            });
        });
        test('defaults page=1 limit=20 when unspecified', async () => {
            const repo = { listByLayerCode: jest.fn().mockResolvedValue([]) };
            await listJobsByLayer('x', {}, { repo });
            expect(repo.listByLayerCode).toHaveBeenCalledWith('x', { limit: 20, offset: 0 });
        });
        test('clamps limit=500 down to 100', async () => {
            const repo = { listByLayerCode: jest.fn().mockResolvedValue([]) };
            await listJobsByLayer('x', { limit: 500 }, { repo });
            expect(repo.listByLayerCode).toHaveBeenCalledWith('x', { limit: 100, offset: 0 });
        });
    });
});
