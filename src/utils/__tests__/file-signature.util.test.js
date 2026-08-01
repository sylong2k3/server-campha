'use strict';
const { detectFileType } = require('../file-signature.util');
describe('file signature validation', () => {
    test('accepts TIFF endian signatures for raster only', () => {
        expect(detectFileType({ originalName: 'map.tif', category: 'raster', head: Buffer.from('49492a00', 'hex') })).toBe('image/tiff');
        expect(detectFileType({ originalName: 'map.tif', category: 'documents', head: Buffer.from('49492a00', 'hex') })).toBeNull();
    });
    test('rejects extension/content mismatch', () => {
        expect(detectFileType({ originalName: 'report.pdf', category: 'documents', head: Buffer.from('MZ executable') })).toBeNull();
    });
    test('checks structural GeoJSON prefix without parsing truncated large content', () => {
        expect(detectFileType({ originalName: 'large.geojson', category: 'layers', head: Buffer.from('  {"type":"FeatureCollection",') })).toBe('application/geo+json');
        expect(detectFileType({ originalName: 'bad.geojson', category: 'layers', head: Buffer.from('<html>') })).toBeNull();
    });
});