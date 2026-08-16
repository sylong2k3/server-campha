'use strict';
const { detectFileType } = require('../file-signature.util');
describe('file signature validation', () => {
    test('accepts TIFF endian signatures for raster only', () => {
        expect(
            detectFileType({
                originalName: 'map.tif',
                category: 'raster',
                head: Buffer.from('49492a00', 'hex'),
            }),
        ).toBe('image/tiff');
        expect(
            detectFileType({
                originalName: 'map.tif',
                category: 'documents',
                head: Buffer.from('49492a00', 'hex'),
            }),
        ).toBeNull();
    });
    test('accepts safe XML and rejects DTD/entity declarations', () => {
        expect(
            detectFileType({
                originalName: 'report.xml',
                category: 'documents',
                head: Buffer.from('<?xml version="1.0"?><report/>'),
            }),
        ).toBe('application/xml');
        expect(
            detectFileType({
                originalName: 'report.xml',
                category: 'documents',
                head: Buffer.from(
                    '<!DOCTYPE x [<!ENTITY e SYSTEM "file:///etc/passwd">]><x>&e;</x>',
                ),
            }),
        ).toBeNull();
    });

    test('rejects executables disguised as documents', () => {
        expect(
            detectFileType({
                originalName: 'report.pdf',
                category: 'documents',
                head: Buffer.from('MZ executable'),
            }),
        ).toBeNull();
    });
    test('accepts JPEG/PNG signatures for documents category', () => {
        expect(
            detectFileType({
                originalName: 'photo.jpg',
                category: 'documents',
                head: Buffer.from('ffd8ffe000104a464946', 'hex'),
            }),
        ).toBe('image/jpeg');
        expect(
            detectFileType({
                originalName: 'photo.png',
                category: 'documents',
                head: Buffer.from('89504e470d0a1a0a', 'hex'),
            }),
        ).toBe('image/png');
    });
    test('checks structural GeoJSON prefix without parsing truncated large content', () => {
        expect(
            detectFileType({
                originalName: 'large.geojson',
                category: 'layers',
                head: Buffer.from('  {"type":"FeatureCollection",'),
            }),
        ).toBe('application/geo+json');
        expect(
            detectFileType({
                originalName: 'bad.geojson',
                category: 'layers',
                head: Buffer.from('<html>'),
            }),
        ).toBeNull();
    });
});
