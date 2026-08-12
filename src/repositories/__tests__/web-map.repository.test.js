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

describe('web map repository accessible layer cache', () => {
    beforeEach(() => jest.clearAllMocks());

    test('coalesces concurrent tile ACL lookups and serves short cache', async () => {
        let resolveQuery;
        mockQuery.mockReturnValue(
            new Promise((resolve) => {
                resolveQuery = resolve;
            }),
        );
        const repository = loadRepository();
        const requests = Array.from({ length: 20 }, () =>
            repository.accessibleLayer(1, { role: 'citizen' }),
        );
        expect(mockQuery).toHaveBeenCalledTimes(1);
        resolveQuery({ rows: [{ id: 1, code: 'ranhgioi_campha' }] });
        await expect(Promise.all(requests)).resolves.toHaveLength(20);
        await expect(repository.accessibleLayer(1, { role: 'citizen' })).resolves.toMatchObject({
            id: 1,
        });
        expect(mockQuery).toHaveBeenCalledTimes(1);
    });

    test('invalidation forces next ACL lookup to query database', async () => {
        mockQuery
            .mockResolvedValueOnce({ rows: [{ id: 1, version: 1 }] })
            .mockResolvedValueOnce({ rows: [{ id: 1, version: 2 }] });
        const repository = loadRepository();
        await expect(repository.accessibleLayer(1, null)).resolves.toMatchObject({ version: 1 });
        repository.invalidateLayerCache(1);
        await expect(repository.accessibleLayer(1, null)).resolves.toMatchObject({ version: 2 });
        expect(mockQuery).toHaveBeenCalledTimes(2);
    });

    test('does not cache failed ACL lookups', async () => {
        mockQuery
            .mockRejectedValueOnce(new Error('db unavailable'))
            .mockResolvedValueOnce({ rows: [{ id: 1 }] });
        const repository = loadRepository();
        await expect(repository.accessibleLayer(1, null)).rejects.toThrow('db unavailable');
        await expect(repository.accessibleLayer(1, null)).resolves.toMatchObject({ id: 1 });
        expect(mockQuery).toHaveBeenCalledTimes(2);
    });
});
