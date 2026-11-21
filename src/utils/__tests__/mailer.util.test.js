const { buildFromAddress } = require('../mailer.util');

describe('buildFromAddress', () => {
    test('uses APP_NAME as display name for a bare address', () => {
        expect(buildFromAddress('noreply@example.vn', 'WebGIS Cẩm Phả')).toEqual({
            name: 'WebGIS Cẩm Phả',
            address: 'noreply@example.vn',
        });
    });

    test('keeps the display name already present in MAIL_FROM', () => {
        expect(buildFromAddress('GIS Cẩm Phả <noreply@example.vn>', 'WebGIS Cẩm Phả')).toEqual({
            name: 'GIS Cẩm Phả',
            address: 'noreply@example.vn',
        });
    });

    test('accepts a quoted display name', () => {
        expect(buildFromAddress('"GIS Cẩm Phả" <noreply@example.vn>', 'App')).toEqual({
            name: 'GIS Cẩm Phả',
            address: 'noreply@example.vn',
        });
    });

    test('falls back to APP_NAME when the angle form has no name', () => {
        expect(buildFromAddress('<noreply@example.vn>', 'App')).toEqual({
            name: 'App',
            address: 'noreply@example.vn',
        });
    });
});
