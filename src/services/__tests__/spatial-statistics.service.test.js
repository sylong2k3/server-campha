'use strict';
jest.mock('../../repositories/spatial-statistics.repository');
jest.mock('../../utils/systemLogger.util', () => ({ logInfo: jest.fn() }));
const repository = require('../../repositories/spatial-statistics.repository');
const service = require('../spatial-statistics.service');
const actor = {
    id: 7,
    role: 'so_tnmt',
    orgId: 2,
    lang: 'vi',
    permissions: { stats: { view: true }, spatial: { analyze: true } },
};
describe('Sprint 7 statistics service', () => {
    beforeEach(() => jest.clearAllMocks());
    test('denies stats read without DB permission', () => {
        expect(() =>
            service.listSources({}, { ...actor, permissions: { stats: { view: false } } }),
        ).toThrow(expect.objectContaining({ status: 403 }));
        expect(repository.list).not.toHaveBeenCalled();
    });
    test('passes role to layer ACL queries', async () => {
        repository.list.mockResolvedValue([]);
        await expect(service.listSources({}, actor)).resolves.toEqual([]);
        expect(repository.list).toHaveBeenCalledWith({}, 'so_tnmt');
    });
    test('denies analyze mutations without permission', async () => {
        await expect(
            service.createSource(
                {},
                { ...actor, permissions: { stats: { view: true }, spatial: { analyze: false } } },
            ),
        ).rejects.toMatchObject({ status: 403 });
        expect(repository.create).not.toHaveBeenCalled();
    });
});
