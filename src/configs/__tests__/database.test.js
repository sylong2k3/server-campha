'use strict';

const mockQuery = jest.fn();
const mockOn = jest.fn();
const mockConnect = jest.fn();
const mockEnd = jest.fn();
let poolOptions;
let loadedDatabase;

jest.mock('pg', () => ({
    Pool: jest.fn().mockImplementation((options) => {
        poolOptions = options;
        return {
            query: mockQuery,
            on: mockOn,
            connect: mockConnect,
            end: mockEnd,
            totalCount: 0,
            idleCount: 0,
            waitingCount: 0,
            options,
        };
    }),
}));

const loadDatabase = () => {
    jest.resetModules();
    loadedDatabase = require('../database');
    return loadedDatabase;
};

describe('database query connection recovery', () => {
    beforeEach(() => {
        mockQuery.mockReset();
        mockOn.mockReset();
        mockConnect.mockReset();
        mockEnd.mockReset();
        poolOptions = undefined;
        loadedDatabase = undefined;
    });

    afterEach(() => {
        loadedDatabase?.stopPoolMonitor();
    });

    test('enables TCP keepalive for remote PostgreSQL connections', () => {
        loadDatabase();
        expect(poolOptions).toMatchObject({
            keepAlive: true,
            keepAliveInitialDelayMillis: 10000,
        });
    });

    test.each(['SELECT 1', 'WITH item AS (SELECT 1) SELECT * FROM item'])(
        'retries read-only query once after connection reset: %s',
        async (sql) => {
            const error = Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' });
            mockQuery
                .mockRejectedValueOnce(error)
                .mockResolvedValueOnce({ rows: [{ ok: 1 }], rowCount: 1 });
            const db = loadDatabase();

            await expect(db.query(sql)).resolves.toMatchObject({ rowCount: 1 });
            expect(mockQuery).toHaveBeenCalledTimes(2);
        },
    );

    test.each([
        ['INSERT INTO core.system_logs(message) VALUES($1)', ['x']],
        ['WITH changed AS (DELETE FROM core.system_logs RETURNING id) SELECT id FROM changed', []],
    ])('does not retry writes because commit outcome may be unknown: %s', async (sql, params) => {
        const error = Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' });
        mockQuery.mockRejectedValueOnce(error);
        const db = loadDatabase();

        await expect(db.query(sql, params)).rejects.toBe(error);
        expect(mockQuery).toHaveBeenCalledTimes(1);
    });
});
