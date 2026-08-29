'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { pipeline } = require('stream/promises');
const archiver = require('archiver');
const minioService = require('./minio.service');
const rasterPipeline = require('./raster-ingest.pipeline');

const MB = 1024 * 1024;
const CONFIG_ENTRY_COUNT = 2;
const INDEXER_PROPERTIES = [
    'TimeAttribute=ingestion',
    'Schema=*the_geom:Polygon,location:String,ingestion:java.util.Date',
    'PropertyCollectors=TimestampFileNameExtractorSPI[timeregex](ingestion)',
    '',
].join('\n');
const TIME_REGEX_PROPERTIES = "regex=[0-9]{17}Z,format=yyyyMMddHHmmssSSS'Z'\n";

class GeoTiffTimeSeriesError extends Error {
    constructor(code, message, details = []) {
        super(message);
        this.name = 'GeoTiffTimeSeriesError';
        this.code = code;
        this.details = details;
    }
}

const positiveEnvInt = (name, fallback) => {
    const value = Number.parseInt(process.env[name], 10);
    return Number.isInteger(value) && value > 0 ? value : fallback;
};

const limits = () => ({
    maxEntries: positiveEnvInt('LAYER_ZIP_MAX_ENTRIES', 64),
    maxEntryBytes: positiveEnvInt('LAYER_ZIP_MAX_ENTRY_MB', 512) * MB,
    maxExpandedBytes: positiveEnvInt('LAYER_ZIP_MAX_EXPANDED_MB', 1024) * MB,
});

const canonicalIsoUtc = (value) => {
    const date = value instanceof Date ? value : new Date(value);
    if (!Number.isFinite(date.getTime())) {
        throw new GeoTiffTimeSeriesError(
            'INVALID_ACQUIRED_AT',
            'Mốc thời gian GeoTIFF không hợp lệ',
        );
    }
    return date.toISOString();
};

const timeToken = (value) => canonicalIsoUtc(value).replace(/[-:.T]/g, '');

const safeResourceName = (value, field = 'resourceName') => {
    const normalized = String(value || '').trim();
    if (!/^[a-z][a-z0-9_]{0,62}$/.test(normalized)) {
        throw new GeoTiffTimeSeriesError(
            'INVALID_RESOURCE_NAME',
            `${field} phải bắt đầu bằng chữ thường và chỉ chứa a-z, 0-9, dấu gạch dưới`,
        );
    }
    return normalized;
};

const granuleFilename = (layerCode, acquiredAt) =>
    `${safeResourceName(layerCode, 'layerCode')}_${timeToken(acquiredAt)}.tif`;

const assertCollectionLimits = (members, archiveLimits = limits()) => {
    if (!Array.isArray(members) || members.length === 0) {
        throw new GeoTiffTimeSeriesError('EMPTY_COLLECTION', 'Bộ GeoTIFF Time Series không có ảnh');
    }
    if (members.length + CONFIG_ENTRY_COUNT > archiveLimits.maxEntries) {
        throw new GeoTiffTimeSeriesError(
            'COLLECTION_ENTRY_LIMIT',
            `Bộ GeoTIFF vượt giới hạn ${archiveLimits.maxEntries} ZIP entries`,
        );
    }
    let expandedBytes =
        Buffer.byteLength(INDEXER_PROPERTIES) + Buffer.byteLength(TIME_REGEX_PROPERTIES);
    for (const member of members) {
        const size = Number(member.size_bytes);
        if (!Number.isSafeInteger(size) || size <= 0) {
            throw new GeoTiffTimeSeriesError(
                'INVALID_FILE_SIZE',
                `Kích thước file ảnh ${member.id} không hợp lệ`,
            );
        }
        if (size > archiveLimits.maxEntryBytes) {
            throw new GeoTiffTimeSeriesError(
                'COLLECTION_ENTRY_TOO_LARGE',
                `File ảnh ${member.id} vượt giới hạn ZIP entry`,
            );
        }
        expandedBytes += size;
        if (expandedBytes > archiveLimits.maxExpandedBytes) {
            throw new GeoTiffTimeSeriesError(
                'COLLECTION_EXPANDED_LIMIT',
                'Tổng dung lượng GeoTIFF vượt giới hạn archive',
            );
        }
    }
    return expandedBytes;
};

const isNullish = (value) => value === null || value === undefined;
const sameNullable = (left, right) => left === right || (isNullish(left) && isNullish(right));

const assertCompatibleRasters = (inspections) => {
    if (!Array.isArray(inspections) || inspections.length === 0) {
        throw new GeoTiffTimeSeriesError('EMPTY_COLLECTION', 'Không có raster để kiểm tra');
    }
    const expected = inspections[0];
    for (let index = 1; index < inspections.length; index += 1) {
        const actual = inspections[index];
        const mismatches = [];
        if (actual.crs !== expected.crs) {
            mismatches.push('crs');
        }
        if (actual.bandCount !== expected.bandCount) {
            mismatches.push('bandCount');
        }
        for (
            let band = 0;
            band < Math.max(expected.bands?.length || 0, actual.bands?.length || 0);
            band += 1
        ) {
            const left = expected.bands?.[band] || {};
            const right = actual.bands?.[band] || {};
            if (left.type !== right.type) {
                mismatches.push(`bands[${band}].type`);
            }
            if (!sameNullable(left.noDataValue, right.noDataValue)) {
                mismatches.push(`bands[${band}].noDataValue`);
            }
            if (!sameNullable(left.colorInterpretation, right.colorInterpretation)) {
                mismatches.push(`bands[${band}].colorInterpretation`);
            }
        }
        if (mismatches.length) {
            throw new GeoTiffTimeSeriesError(
                'INCOMPATIBLE_RASTERS',
                `GeoTIFF tại vị trí ${index + 1} không tương thích`,
                mismatches,
            );
        }
    }
    return expected;
};

const createZip = async (archivePath, files, dependencies = {}) => {
    const makeArchive = dependencies.archiver || archiver;
    const output = fs.createWriteStream(archivePath, { flags: 'wx' });
    const archive = makeArchive('zip', { zlib: { level: 6 } });
    const closed = new Promise((resolve, reject) => {
        output.once('close', resolve);
        output.once('error', reject);
        archive.once('error', reject);
        archive.once('warning', reject);
    });
    archive.pipe(output);
    archive.append(INDEXER_PROPERTIES, { name: 'indexer.properties' });
    archive.append(TIME_REGEX_PROPERTIES, { name: 'timeregex.properties' });
    for (const file of files) {
        archive.file(file.path, { name: file.name });
    }
    await archive.finalize();
    await closed;
};

const defaultDownload = async (member, targetPath) => {
    const source = await minioService.getObjectStream({
        category: member.category || 'raster',
        objectKey: member.object_key,
    });
    await pipeline(source, fs.createWriteStream(targetPath, { flags: 'wx' }));
};

const materializeImageMosaic = async ({ layerCode, members }, dependencies = {}) => {
    const inspect = dependencies.inspect || rasterPipeline.defaultValidateCrs;
    const download = dependencies.download || defaultDownload;
    const makeZip = dependencies.createZip || createZip;
    const root = dependencies.workDir || process.env.LAYER_WORK_DIR || os.tmpdir();
    safeResourceName(layerCode, 'layerCode');
    assertCollectionLimits(members, dependencies.limits || limits());

    await fs.promises.mkdir(root, { recursive: true });
    const workDir = await fs.promises.mkdtemp(path.join(root, `campha-mosaic-${layerCode}-`));
    const archivePath = path.join(workDir, `${layerCode}.zip`);
    const files = [];
    try {
        for (const member of members) {
            const name = granuleFilename(layerCode, member.acquired_at);
            const targetPath = path.join(workDir, name);
            await download(member, targetPath);
            const stat = await fs.promises.stat(targetPath);
            if (stat.size !== Number(member.size_bytes)) {
                throw new GeoTiffTimeSeriesError(
                    'FILE_SIZE_MISMATCH',
                    `Kích thước object ảnh ${member.id} không khớp DB`,
                );
            }
            files.push({ name, path: targetPath, inspection: await inspect(targetPath) });
        }
        const compatibility = assertCompatibleRasters(files.map((file) => file.inspection));
        await makeZip(archivePath, files);
        return {
            archivePath,
            workDir,
            compatibility,
            files: files.map(({ name }) => name),
            cleanup: () => fs.promises.rm(workDir, { recursive: true, force: true }),
        };
    } catch (error) {
        await fs.promises.rm(workDir, { recursive: true, force: true });
        throw error;
    }
};

module.exports = {
    GeoTiffTimeSeriesError,
    INDEXER_PROPERTIES,
    TIME_REGEX_PROPERTIES,
    canonicalIsoUtc,
    timeToken,
    granuleFilename,
    assertCollectionLimits,
    assertCompatibleRasters,
    createZip,
    materializeImageMosaic,
};
