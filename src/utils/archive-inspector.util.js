'use strict';

const fs = require('fs');
const path = require('path');
const { TextDecoder } = require('util');
const { Api422Error } = require('../core/error.response');

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const ZIP64_SENTINEL_16 = 0xffff;
const ZIP64_SENTINEL_32 = 0xffffffff;
const NESTED_ARCHIVE = /\.(?:zip|7z|rar|tar|gz|bz2|xz)$/i;
const REQUIRED_SHAPEFILE_EXTENSIONS = ['.shp', '.dbf', '.shx', '.prj'];

const fail = (code, message) => { throw new Api422Error(message, [code]); };

const findEocd = (buffer) => {
    const min = Math.max(0, buffer.length - 65557);
    for (let offset = buffer.length - 22; offset >= min; offset--) {
        if (buffer.readUInt32LE(offset) === EOCD_SIGNATURE) { return offset; }
    }
    fail('ZIP_EOCD_MISSING', 'ZIP không có central directory hợp lệ');
};

const decodeName = (buffer, utf8) => {
    if (utf8) {
        try { return new TextDecoder('utf-8', { fatal: true }).decode(buffer); }
        catch { fail('ZIP_FILENAME_ENCODING', 'Tên file ZIP không phải UTF-8 hợp lệ'); }
    }
    // Security-first fallback for old ZIPs: ASCII only. DBF encoding is handled separately.
    if ([...buffer].some((byte) => byte > 0x7f)) {
        fail('ZIP_FILENAME_ENCODING', 'Tên file ZIP cũ phải dùng ASCII hoặc UTF-8');
    }
    return buffer.toString('ascii');
};

const inspectShapefileZip = (filePath, overrides = {}) => {
    const limits = {
        maxEntries: Number(overrides.maxEntries ?? process.env.LAYER_ZIP_MAX_ENTRIES ?? 100),
        maxEntryBytes: Number(overrides.maxEntryMb ?? process.env.LAYER_ZIP_MAX_ENTRY_MB ?? 600) * 1024 * 1024,
        maxExpandedBytes: Number(overrides.maxExpandedMb ?? process.env.LAYER_ZIP_MAX_EXPANDED_MB ?? 1000) * 1024 * 1024,
        maxCompressionRatio: Number(overrides.maxCompressionRatio ?? process.env.LAYER_ZIP_MAX_COMPRESSION_RATIO ?? 100),
    };
    const buffer = fs.readFileSync(filePath);
    if (buffer.length < 22 || buffer.readUInt32LE(0) !== 0x04034b50) {
        fail('ZIP_SIGNATURE_INVALID', 'Nội dung không phải ZIP hợp lệ');
    }
    const eocd = findEocd(buffer);
    const disk = buffer.readUInt16LE(eocd + 4);
    const centralDisk = buffer.readUInt16LE(eocd + 6);
    const entriesOnDisk = buffer.readUInt16LE(eocd + 8);
    const entryCount = buffer.readUInt16LE(eocd + 10);
    const centralSize = buffer.readUInt32LE(eocd + 12);
    const centralOffset = buffer.readUInt32LE(eocd + 16);
    if (disk !== 0 || centralDisk !== 0 || entriesOnDisk !== entryCount) {
        fail('ZIP_MULTIDISK_UNSUPPORTED', 'ZIP nhiều volume không được hỗ trợ');
    }
    if (entryCount === ZIP64_SENTINEL_16 || centralSize === ZIP64_SENTINEL_32 || centralOffset === ZIP64_SENTINEL_32) {
        fail('ZIP64_UNSUPPORTED', 'ZIP64 không được hỗ trợ');
    }
    if (entryCount < 1 || entryCount > limits.maxEntries) {
        fail('ZIP_ENTRY_LIMIT', `ZIP phải có 1-${limits.maxEntries} mục`);
    }
    if (centralOffset + centralSize > eocd || centralOffset < 0) {
        fail('ZIP_CENTRAL_DIRECTORY_INVALID', 'Central directory nằm ngoài giới hạn ZIP');
    }

    const entries = [];
    const seen = new Set();
    let offset = centralOffset;
    let expandedTotal = 0;
    for (let index = 0; index < entryCount; index++) {
        if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== CENTRAL_SIGNATURE) {
            fail('ZIP_CENTRAL_ENTRY_INVALID', 'Central directory entry bị lỗi');
        }
        const versionMadeBy = buffer.readUInt16LE(offset + 4);
        const flags = buffer.readUInt16LE(offset + 8);
        const compressionMethod = buffer.readUInt16LE(offset + 10);
        const compressedSize = buffer.readUInt32LE(offset + 20);
        const expandedSize = buffer.readUInt32LE(offset + 24);
        const nameLength = buffer.readUInt16LE(offset + 28);
        const extraLength = buffer.readUInt16LE(offset + 30);
        const commentLength = buffer.readUInt16LE(offset + 32);
        const externalAttributes = buffer.readUInt32LE(offset + 38);
        const localOffset = buffer.readUInt32LE(offset + 42);
        if (compressedSize === ZIP64_SENTINEL_32 || expandedSize === ZIP64_SENTINEL_32 || localOffset === ZIP64_SENTINEL_32) {
            fail('ZIP64_UNSUPPORTED', 'ZIP64 entry không được hỗ trợ');
        }
        if ((flags & 0x1) !== 0) { fail('ZIP_ENCRYPTED', 'ZIP mã hóa không được hỗ trợ'); }
        if ((flags & 0x8) !== 0) { fail('ZIP_DATA_DESCRIPTOR_UNSUPPORTED', 'ZIP data descriptor không được hỗ trợ'); }
        if (![0, 8].includes(compressionMethod)) { fail('ZIP_COMPRESSION_UNSUPPORTED', 'ZIP chỉ hỗ trợ STORE hoặc DEFLATE'); }
        const nameStart = offset + 46;
        const next = nameStart + nameLength + extraLength + commentLength;
        if (!nameLength || next > centralOffset + centralSize || next > buffer.length) {
            fail('ZIP_CENTRAL_ENTRY_INVALID', 'Tên hoặc metadata ZIP bị lỗi');
        }
        const name = decodeName(buffer.subarray(nameStart, nameStart + nameLength), (flags & 0x800) !== 0)
            .replace(/\\/g, '/');
        if (name.includes('\0') || [...name].some((character) => {
            const code = character.codePointAt(0);
            return code < 0x20 || code === 0x7f;
        })) {
            fail('ZIP_FILENAME_INVALID', 'Tên file ZIP chứa ký tự điều khiển');
        }
        if (name.startsWith('/') || /^[A-Za-z]:/.test(name) || name.split('/').includes('..') || name.includes(':')) {
            fail('ZIP_PATH_TRAVERSAL', 'ZIP chứa đường dẫn không an toàn');
        }
        const normalized = path.posix.normalize(name);
        if (normalized === '.' || normalized.startsWith('../')) {
            fail('ZIP_PATH_TRAVERSAL', 'ZIP chứa đường dẫn không an toàn');
        }
        const collisionKey = normalized.toLocaleLowerCase('en-US');
        if (seen.has(collisionKey)) { fail('ZIP_DUPLICATE_ENTRY', 'ZIP có tên file trùng hoặc khác biệt hoa/thường'); }
        seen.add(collisionKey);
        const unixMode = (externalAttributes >>> 16) & 0xffff;
        const isSymlink = (versionMadeBy >>> 8) === 3 && (unixMode & 0xf000) === 0xa000;
        if (isSymlink) { fail('ZIP_SYMLINK', 'ZIP không được chứa symbolic link'); }
        const isDirectory = normalized.endsWith('/');
        if (!isDirectory && NESTED_ARCHIVE.test(normalized)) {
            fail('ZIP_NESTED_ARCHIVE', 'ZIP không được chứa archive lồng nhau');
        }
        if (expandedSize > limits.maxEntryBytes) { fail('ZIP_ENTRY_TOO_LARGE', 'Một file trong ZIP vượt giới hạn'); }
        expandedTotal += expandedSize;
        if (expandedTotal > limits.maxExpandedBytes) { fail('ZIP_EXPANDED_TOO_LARGE', 'Tổng dữ liệu giải nén vượt giới hạn'); }
        const ratio = expandedSize === 0 ? 0 : expandedSize / Math.max(1, compressedSize);
        if (ratio > limits.maxCompressionRatio) { fail('ZIP_BOMB_RATIO', 'Tỷ lệ nén ZIP vượt giới hạn'); }
        const localHeaderEnd = localOffset + 30;
        if (localHeaderEnd > centralOffset || buffer.readUInt32LE(localOffset) !== LOCAL_SIGNATURE) {
            fail('ZIP_LOCAL_ENTRY_INVALID', 'Local ZIP entry bị lỗi hoặc nằm ngoài vùng dữ liệu');
        }
        const localFlags = buffer.readUInt16LE(localOffset + 6);
        const localMethod = buffer.readUInt16LE(localOffset + 8);
        const localCompressedSize = buffer.readUInt32LE(localOffset + 18);
        const localExpandedSize = buffer.readUInt32LE(localOffset + 22);
        const localNameLength = buffer.readUInt16LE(localOffset + 26);
        const localExtraLength = buffer.readUInt16LE(localOffset + 28);
        const localNameStart = localOffset + 30;
        const localDataStart = localNameStart + localNameLength + localExtraLength;
        if (localDataStart + compressedSize > centralOffset || localFlags !== flags || localMethod !== compressionMethod
            || localCompressedSize !== compressedSize || localExpandedSize !== expandedSize
            || localNameLength !== nameLength
            || !buffer.subarray(localNameStart, localNameStart + localNameLength).equals(buffer.subarray(nameStart, nameStart + nameLength))) {
            fail('ZIP_LOCAL_ENTRY_MISMATCH', 'Local ZIP entry không khớp central directory');
        }
        if (!isDirectory) { entries.push({ name: normalized, compressedSize, expandedSize }); }
        offset = next;
    }
    if (offset !== centralOffset + centralSize) {
        fail('ZIP_CENTRAL_DIRECTORY_INVALID', 'Central directory có dữ liệu thừa hoặc thiếu');
    }

    const shapeEntries = entries.filter((entry) => REQUIRED_SHAPEFILE_EXTENSIONS.includes(path.posix.extname(entry.name).toLowerCase()));
    const groups = new Map();
    for (const entry of shapeEntries) {
        const ext = path.posix.extname(entry.name).toLowerCase();
        const key = entry.name.slice(0, -ext.length).toLocaleLowerCase('en-US');
        if (!groups.has(key)) { groups.set(key, new Map()); }
        groups.get(key).set(ext, entry.name);
    }
    const complete = [...groups.entries()].filter(([, files]) => REQUIRED_SHAPEFILE_EXTENSIONS.every((ext) => files.has(ext)));
    if (complete.length !== 1 || groups.size !== 1) {
        fail('SHAPEFILE_DATASET_AMBIGUOUS', 'ZIP phải chứa đúng một bộ .shp/.dbf/.shx/.prj cùng tên');
    }
    const [datasetKey, files] = complete[0];
    const optionalCpg = entries.find((entry) => {
        const ext = path.posix.extname(entry.name).toLowerCase();
        return ext === '.cpg' && entry.name.slice(0, -ext.length).toLocaleLowerCase('en-US') === datasetKey;
    });
    return {
        entryCount,
        expandedBytes: expandedTotal,
        shapefilePath: files.get('.shp'),
        files: Object.fromEntries(REQUIRED_SHAPEFILE_EXTENSIONS.map((ext) => [ext.slice(1), files.get(ext)])),
        cpgPath: optionalCpg?.name || null,
    };
};

module.exports = { inspectShapefileZip, REQUIRED_SHAPEFILE_EXTENSIONS };
