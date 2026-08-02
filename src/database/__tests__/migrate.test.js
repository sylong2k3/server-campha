jest.mock('../../configs/database', () => ({
    pool: {
        query: jest.fn(),
        connect: jest.fn(),
        end: jest.fn(),
    },
}));

const { calculateChecksum, assertChecksums, getMigrationFiles } = require('../migrate');

describe('migration safety', () => {
    test('SHA256 ổn định và nhạy với nội dung', () => {
        expect(calculateChecksum('SELECT 1;')).toHaveLength(64);
        expect(calculateChecksum('SELECT 1;')).toBe(calculateChecksum('SELECT 1;'));
        expect(calculateChecksum('SELECT 1;')).not.toBe(calculateChecksum('SELECT 2;'));
    });

    test('migration file luôn được sắp xếp và có checksum', () => {
        const files = getMigrationFiles();
        expect(files.map((file) => file.filename)).toEqual(
            [...files.map((file) => file.filename)].sort(),
        );
        expect(files.every((file) => file.checksum.length === 64 && file.sql.length > 0)).toBe(
            true,
        );
    });

    test('từ chối migration đã áp dụng nhưng bị sửa', () => {
        const files = [{ filename: '001.sql', checksum: calculateChecksum('new') }];
        const executed = new Map([
            ['001.sql', { filename: '001.sql', checksum: calculateChecksum('old') }],
        ]);
        expect(() => assertChecksums(executed, files)).toThrow(
            'Migration checksum mismatch: 001.sql',
        );
    });

    test('từ chối migration đã áp dụng nhưng file bị xóa', () => {
        const executed = new Map([
            ['001.sql', { filename: '001.sql', checksum: calculateChecksum('old') }],
        ]);
        expect(() => assertChecksums(executed, [])).toThrow(
            'Applied migration file is missing: 001.sql',
        );
    });
});
