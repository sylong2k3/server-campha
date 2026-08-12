'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { isTiffBuffer, isTiffFile, TIFF_MAGIC_LENGTH } = require('../geotiff.util');

const II_TIFF = Buffer.from([0x49, 0x49, 0x2a, 0x00, 0xff, 0xff]);
const MM_TIFF = Buffer.from([0x4d, 0x4d, 0x00, 0x2a, 0xff, 0xff]);
const II_BIGTIFF = Buffer.from([0x49, 0x49, 0x2b, 0x00, 0xff]);
const MM_BIGTIFF = Buffer.from([0x4d, 0x4d, 0x00, 0x2b, 0xff]);
const NOT_TIFF = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0xff]); // ZIP magic
const TOO_SHORT = Buffer.from([0x49, 0x49]);

describe('geotiff.util.isTiffBuffer', () => {
    test('accepts all 4 valid TIFF/BigTIFF magic-byte prefixes', () => {
        expect(isTiffBuffer(II_TIFF)).toBe(true);
        expect(isTiffBuffer(MM_TIFF)).toBe(true);
        expect(isTiffBuffer(II_BIGTIFF)).toBe(true);
        expect(isTiffBuffer(MM_BIGTIFF)).toBe(true);
    });

    test('rejects non-TIFF magic (ZIP)', () => {
        expect(isTiffBuffer(NOT_TIFF)).toBe(false);
    });

    test('rejects buffers shorter than the magic length', () => {
        expect(isTiffBuffer(TOO_SHORT)).toBe(false);
        expect(isTiffBuffer(Buffer.alloc(0))).toBe(false);
    });

    test('rejects non-Buffer inputs', () => {
        expect(isTiffBuffer(null)).toBe(false);
        expect(isTiffBuffer(undefined)).toBe(false);
        expect(isTiffBuffer('II*\0')).toBe(false);
        expect(isTiffBuffer([0x49, 0x49, 0x2a, 0x00])).toBe(false);
    });

    test('exports the magic byte length constant', () => {
        expect(TIFF_MAGIC_LENGTH).toBe(4);
    });
});

describe('geotiff.util.isTiffFile', () => {
    let tmpDir;

    beforeAll(async () => {
        tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'geotiff-util-test-'));
    });

    afterAll(async () => {
        await fs.promises.rm(tmpDir, { recursive: true, force: true });
    });

    const write = async (name, buffer) => {
        const file = path.join(tmpDir, name);
        await fs.promises.writeFile(file, buffer);
        return file;
    };

    test('returns true for a valid little-endian TIFF file', async () => {
        const file = await write('valid-ii.tif', II_TIFF);
        await expect(isTiffFile(file)).resolves.toBe(true);
    });

    test('returns true for a valid BigTIFF file', async () => {
        const file = await write('valid-bigtiff.tif', MM_BIGTIFF);
        await expect(isTiffFile(file)).resolves.toBe(true);
    });

    test('returns false for a ZIP file', async () => {
        const file = await write('actually-a-zip.tif', NOT_TIFF);
        await expect(isTiffFile(file)).resolves.toBe(false);
    });

    test('returns false for a file shorter than the magic length', async () => {
        const file = await write('too-short.tif', TOO_SHORT);
        await expect(isTiffFile(file)).resolves.toBe(false);
    });

    test('returns false (does not throw) when the file does not exist', async () => {
        await expect(isTiffFile(path.join(tmpDir, 'no-such-file.tif'))).resolves.toBe(false);
    });
});
