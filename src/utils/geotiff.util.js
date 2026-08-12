'use strict';

/**
 * Magic-byte validation for (Geo)TIFF files. Content-Type / extension can be
 * spoofed; magic bytes cannot without producing a broken file. Used by the
 * raster-ingest pipeline before uploading to MinIO / publishing to GeoServer.
 *
 * TIFF header (first 4 bytes):
 *   49 49 2A 00  → "II*\0"  little-endian TIFF
 *   4D 4D 00 2A  → "MM\0*"  big-endian    TIFF
 *   49 49 2B 00  → little-endian BigTIFF
 *   4D 4D 00 2B  → big-endian    BigTIFF
 * GeoTIFF shares the TIFF container; deeper GeoTIFF-tag validation (CRS,
 * pixel size) belongs in the GDAL wrapper, not this cheap magic check.
 *
 * @ported-from migration/kt_gee_migration/utils/geotiff.util.js
 */

const fs = require('fs');

const TIFF_MAGICS = [
    Buffer.from([0x49, 0x49, 0x2a, 0x00]),
    Buffer.from([0x4d, 0x4d, 0x00, 0x2a]),
    Buffer.from([0x49, 0x49, 0x2b, 0x00]),
    Buffer.from([0x4d, 0x4d, 0x00, 0x2b]),
];

const TIFF_MAGIC_LENGTH = 4;

/**
 * @param {Buffer} buf — must contain at least the first 4 bytes of the file.
 * @returns {boolean}
 */
const isTiffBuffer = (buf) => {
    if (!Buffer.isBuffer(buf) || buf.length < TIFF_MAGIC_LENGTH) {
        return false;
    }
    const head = buf.subarray(0, TIFF_MAGIC_LENGTH);
    return TIFF_MAGICS.some((magic) => head.equals(magic));
};

/**
 * Read only the first 4 bytes of the file to check the TIFF magic. Small
 * open-read-close call — safe on multi-GB rasters. Returns false on any I/O
 * failure (file not found, permission denied) rather than throwing, so the
 * ingest pipeline can classify unreadable files distinctly from wrong-format
 * files at a higher level.
 *
 * @param {string} filePath
 * @returns {Promise<boolean>}
 */
async function isTiffFile(filePath) {
    let handle;
    try {
        handle = await fs.promises.open(filePath, 'r');
        const buf = Buffer.alloc(TIFF_MAGIC_LENGTH);
        const { bytesRead } = await handle.read(buf, 0, TIFF_MAGIC_LENGTH, 0);
        if (bytesRead < TIFF_MAGIC_LENGTH) {
            return false;
        }
        return isTiffBuffer(buf);
    } catch {
        return false;
    } finally {
        if (handle) {
            await handle.close().catch(() => {});
        }
    }
}

module.exports = { isTiffBuffer, isTiffFile, TIFF_MAGIC_LENGTH };
