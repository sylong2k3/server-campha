'use strict';
jest.mock('../../configs/database', () => ({ query: jest.fn(), getClient: jest.fn() }));
const { quote } = require('../spatial-statistics.repository');
describe('statistics SQL identifiers', () => {
    test('quotes allowlisted identifiers', () => {
        expect(quote('flood_2026')).toBe('"flood_2026"');
    });
    test.each(['Flood', 'flood-2026', 'flood;drop', 'gis.flood', '1flood'])(
        'rejects unsafe identifier %s',
        (value) => {
            expect(() => quote(value)).toThrow(TypeError);
        },
    );
});
