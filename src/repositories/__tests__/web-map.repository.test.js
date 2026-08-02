'use strict';

const mockQuery = jest.fn();
jest.mock('../../configs/database', () => ({ query: mockQuery }));

const loadRepository = () => {
    let repository;
    jest.isolateModules(() => {
        repository = require('../web-map.repository');
    });
    return repository;
};

describe('web map repository basemap cache', () => {
    beforeEach(() => jest.clearAllMocks());

    test('shares concurrent query and serves the 60-second cache', async () => {
        let resolveQuery;
        mockQuery.mockReturnValue(
            new Promise((resolve) => {
                resolveQuery = resolve;
            }),
        );
        const repository = loadRepository();
        const first = repository.basemaps();
        const second = repository.basemaps();
        expect(mockQuery).toHaveBeenCalledTimes(1);
        resolveQuery({ rows: [{ code: 'osm' }] });
        await expect(Promise.all([first, second])).resolves.toEqual([
            [{ code: 'osm' }],
            [{ code: 'osm' }],
        ]);
        await expect(repository.basemaps()).resolves.toEqual([{ code: 'osm' }]);
        expect(mockQuery).toHaveBeenCalledTimes(1);
    });

    test('does not cache query failures', async () => {
        mockQuery.mockRejectedValueOnce(new Error('db unavailable'));
        const repository = loadRepository();
        await expect(repository.basemaps()).rejects.toThrow('db unavailable');
        mockQuery.mockResolvedValueOnce({ rows: [{ code: 'osm' }] });
        await expect(repository.basemaps()).resolves.toEqual([{ code: 'osm' }]);
        expect(mockQuery).toHaveBeenCalledTimes(2);
    });
});
