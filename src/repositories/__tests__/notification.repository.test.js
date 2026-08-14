'use strict';
jest.mock('../../configs/database', () => ({ query: jest.fn() }));
const db = require('../../configs/database');
const repository = require('../notification.repository');
describe('notification.repository', () => {
    beforeEach(() => jest.clearAllMocks());
    test('createMany dedupes user ids and no-ops for an empty list', async () => {
        expect(await repository.createMany([], { title: 't' })).toEqual([]);
        expect(db.query).not.toHaveBeenCalled();

        db.query.mockResolvedValue({ rows: [{ id: 1, user_id: 5 }] });
        await repository.createMany([5, 5, 9], { type: 'x', title: 't', body: 'b', data: { a: 1 } });
        expect(db.query.mock.calls[0][1][0]).toEqual([5, 9]);
    });
    test('listForUser scopes to the requesting user and applies unreadOnly', async () => {
        db.query
            .mockResolvedValueOnce({ rows: [{ id: 1 }] })
            .mockResolvedValueOnce({ rows: [{ total: 1 }] });
        const result = await repository.listForUser(7, { page: 2, limit: 10, unreadOnly: true });
        expect(result).toEqual({ items: [{ id: 1 }], total: 1 });
        const [sql, params] = db.query.mock.calls[0];
        expect(sql).toMatch(/user_id=\$1 AND read_at IS NULL/);
        expect(params).toEqual([7, 10, 10]);
    });
    test('markRead only affects the owning user and unread rows', async () => {
        db.query.mockResolvedValue({ rows: [] });
        expect(await repository.markRead(1, 7)).toBeNull();
        expect(db.query.mock.calls[0][1]).toEqual([1, 7]);
    });
    test('markAllRead returns the number of rows updated', async () => {
        db.query.mockResolvedValue({ rows: [{ id: 1 }, { id: 2 }] });
        expect(await repository.markAllRead(7)).toBe(2);
    });
    test('remove only deletes a notification owned by the requesting user', async () => {
        db.query.mockResolvedValue({ rows: [{ id: 4 }] });
        expect(await repository.remove(4, 7)).toEqual({ id: 4 });
        expect(db.query.mock.calls[0][1]).toEqual([4, 7]);
        expect(db.query.mock.calls[0][0]).toMatch(/id=\$1 AND user_id=\$2/);
    });
});
