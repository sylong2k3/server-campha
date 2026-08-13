jest.mock('../../configs/database', () => ({
    pool: {
        query: jest.fn(),
        connect: jest.fn(),
        end: jest.fn(),
    },
}));

const {
    calculateChecksum,
    calculateLegacyWindowsChecksum,
    assertChecksums,
    getMigrationFiles,
    parseOnlyMigrationNames,
    selectMigrationFiles,
} = require('../migrate');

describe('migration safety', () => {
    test('SHA256 ổn định và nhạy với nội dung', () => {
        expect(calculateChecksum('SELECT 1;')).toHaveLength(64);
        expect(calculateChecksum('SELECT 1;')).toBe(calculateChecksum('SELECT 1;'));
        expect(calculateChecksum('SELECT 1;')).not.toBe(calculateChecksum('SELECT 2;'));
        expect(calculateChecksum('SELECT 1;\n')).toBe(calculateChecksum('SELECT 1;\r\n'));
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

    test('accepts a legacy Windows newline checksum only', () => {
        const sql = 'SELECT 1;\n';
        const files = [{ filename: '001.sql', sql, checksum: calculateChecksum(sql) }];
        const executed = new Map([
            [
                '001.sql',
                {
                    filename: '001.sql',
                    checksum: calculateLegacyWindowsChecksum(sql),
                },
            ],
        ]);
        expect(() => assertChecksums(executed, files)).not.toThrow();
    });

    test('từ chối migration đã áp dụng nhưng file bị xóa', () => {
        const executed = new Map([
            ['001.sql', { filename: '001.sql', checksum: calculateChecksum('old') }],
        ]);
        expect(() => assertChecksums(executed, [])).toThrow(
            'Applied migration file is missing: 001.sql',
        );
    });

    test('recovery selection accepts only known migration filenames', () => {
        const files = [{ filename: '087_restore_legacy_satellite.sql' }];
        expect(selectMigrationFiles(files, ['087_restore_legacy_satellite.sql'])).toEqual(files);
        expect(() => selectMigrationFiles(files, ['999_missing.sql'])).toThrow(/Unknown migration/);
        expect(
            parseOnlyMigrationNames([
                'node',
                'migrate.js',
                '--only=087_restore_legacy_satellite.sql',
            ]),
        ).toEqual(['087_restore_legacy_satellite.sql']);
    });
});
