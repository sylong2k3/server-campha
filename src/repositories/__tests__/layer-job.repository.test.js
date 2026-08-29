'use strict';

jest.mock('../../configs/database', () => ({
    getClient: jest.fn(),
    query: jest.fn(),
}));
const db = require('../../configs/database');
const repository = require('../layer-job.repository');

describe('layer-job repository cleanup completion', () => {
    test('detaches Time Series members only after lease-safe job completion', async () => {
        const client = {
            query: jest
                .fn()
                .mockResolvedValueOnce({})
                .mockResolvedValueOnce({ rowCount: 1 })
                .mockResolvedValueOnce({ rowCount: 1 })
                .mockResolvedValueOnce({ rowCount: 4 })
                .mockResolvedValueOnce({}),
            release: jest.fn(),
        };
        db.getClient.mockResolvedValue(client);

        await expect(repository.completeCleanup(7, 'worker-a', 9)).resolves.toBe(true);

        expect(client.query.mock.calls.map(([sql]) => sql)).toEqual([
            'BEGIN',
            expect.stringContaining("SET status = 'succeeded'"),
            "UPDATE gis.layers SET cleanup_status = 'complete' WHERE id = $1",
            'UPDATE raster.satellite_images SET layer_id=NULL WHERE layer_id=$1',
            'COMMIT',
        ]);
        expect(client.release).toHaveBeenCalled();
    });

    test('does not detach members when cleanup lease is lost', async () => {
        const client = {
            query: jest
                .fn()
                .mockResolvedValueOnce({})
                .mockResolvedValueOnce({ rowCount: 0 })
                .mockResolvedValueOnce({}),
            release: jest.fn(),
        };
        db.getClient.mockResolvedValue(client);

        await expect(repository.completeCleanup(7, 'worker-a', 9)).resolves.toBe(false);

        expect(client.query).not.toHaveBeenCalledWith(
            'UPDATE raster.satellite_images SET layer_id=NULL WHERE layer_id=$1',
            expect.anything(),
        );
        expect(client.query).toHaveBeenLastCalledWith('ROLLBACK');
    });
});
