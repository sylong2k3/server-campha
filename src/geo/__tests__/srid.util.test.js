'use strict';
const { SRID, assertSupportedSrid, transformPoint } = require('../srid.util');
describe('SRID utility', () => {
    test('allows only project coordinate systems', () => {
        expect(assertSupportedSrid(SRID.VN2000_TM3_107_45)).toBe(5899);
        expect(() => assertSupportedSrid(3857)).toThrow(TypeError);
    });
    test('passes SRIDs as parameters to PostGIS', async () => {
        const db = { query: jest.fn().mockResolvedValue({ rows: [{ x: '123', y: '456' }] }) };
        await expect(transformPoint(db, { longitude: 107, latitude: 21, targetSrid: 5899 }))
            .resolves.toEqual({ x: 123, y: 456, srid: 5899 });
        expect(db.query.mock.calls[0][1]).toEqual([107, 21, 4326, 5899]);
    });
});