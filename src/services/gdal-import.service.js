'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const db = require('../configs/database');
const minioService = require('./minio.service');
const layerRepository = require('../repositories/layer.repository');
const geoserverClient = require('../utils/geoserver.client');
const { inspectShapefileZip } = require('../utils/archive-inspector.util');
const { Api422Error } = require('../core/error.response');

const IDENTIFIER = /^[a-z][a-z0-9_]{0,62}$/;
const ERROR_LIMIT = Number(process.env.LAYER_IMPORT_ERROR_LIMIT || 1000);
const PROCESS_TIMEOUT_MS = Number(process.env.LAYER_GDAL_TIMEOUT_MS || 10 * 60 * 1000);
const DB_TIMEOUT_MS = Number(process.env.LAYER_DB_TIMEOUT_MS || 5 * 60 * 1000);
const SOURCE_ENCODINGS = new Set(['UTF-8', 'CP1258', 'WINDOWS-1252']);

class LayerImportValidationError extends Error {
    constructor(code, message, errors = []) {
        super(message);
        this.name = 'LayerImportValidationError';
        this.code = code;
        this.importErrors = errors;
    }
}

const quoteIdentifier = (value) => {
    if (!IDENTIFIER.test(value)) {
        throw new TypeError('Unsafe generated SQL identifier');
    }
    return `"${value}"`;
};
const quoteSourceField = (value) => {
    if (!/^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(value)) {
        throw new TypeError('Unsafe source field');
    }
    return `"${value.replaceAll('"', '""')}"`;
};
const generatedTable = (prefix, job) =>
    `${prefix}_${job.id}_${crypto.createHash('sha256').update(`${job.id}:${job.input_payload.code}`).digest('hex').slice(0, 8)}`;

const getTool = (envName, fallback) => {
    const configured = process.env[envName]?.trim() || fallback;
    if (!configured || /[\r\n\0]/.test(configured)) {
        throw new Error(`${envName} is invalid`);
    }
    return configured;
};

const processEnv = () => ({
    ...process.env,
    PGPASSWORD: process.env.DB_PASSWORD,
    PGOPTIONS: `-c statement_timeout=${DB_TIMEOUT_MS} -c lock_timeout=10000`,
    ...(process.env.PROJ_DATA_PATH ? { PROJ_DATA: process.env.PROJ_DATA_PATH } : {}),
    ...(process.env.GDAL_DATA_PATH ? { GDAL_DATA: process.env.GDAL_DATA_PATH } : {}),
});

const runTool = (tool, args, timeout = PROCESS_TIMEOUT_MS) =>
    new Promise((resolve, reject) => {
        execFile(
            tool,
            args,
            {
                shell: false,
                windowsHide: true,
                timeout,
                maxBuffer: 4 * 1024 * 1024,
                env: processEnv(),
            },
            (error, stdout, stderr) => {
                if (error) {
                    const safeMessage = String(stderr || error.message || 'GDAL failed')
                        .replaceAll(process.env.DB_PASSWORD || '__NO_PASSWORD__', '[REDACTED]')
                        .slice(0, 2000);
                    const failure = new Error(safeMessage);
                    failure.code = error.killed ? 'GDAL_TIMEOUT' : 'GDAL_FAILED';
                    return reject(failure);
                }
                resolve({ stdout, stderr });
            },
        );
    });

const postgresDatasource = () => {
    const values = {
        host: process.env.DB_HOST,
        port: process.env.DB_PORT,
        dbname: process.env.DB_NAME,
        user: process.env.DB_USER,
    };
    for (const [key, value] of Object.entries(values)) {
        if (!value || /['\\\r\n\0]/.test(String(value))) {
            throw new Error(`Database ${key} is invalid for GDAL`);
        }
    }
    return `PG:host='${values.host}' port='${values.port}' dbname='${values.dbname}' user='${values.user}'`;
};

const inspectSource = async (source, layerName, openOptions = []) => {
    const args = ['-json', '-so', ...openOptions.flatMap((option) => ['-oo', option]), source];
    if (layerName) {
        args.push(layerName);
    }
    const { stdout } = await runTool(getTool('GDAL_OGRINFO_PATH', 'ogrinfo'), args, 60000);
    try {
        return JSON.parse(stdout);
    } catch {
        throw new LayerImportValidationError(
            'OGRINFO_INVALID_JSON',
            'Không đọc được metadata GDAL',
        );
    }
};

const assertSridExists = async (srid) => {
    const { rowCount } = await db.query('SELECT 1 FROM spatial_ref_sys WHERE srid = $1', [srid]);
    if (!rowCount) {
        throw new LayerImportValidationError(
            'SRID_NOT_FOUND',
            `SRID ${srid} không tồn tại trong PostGIS`,
        );
    }
};

const parseShapefileMetadata = (info) => {
    if (info.driverShortName !== 'ESRI Shapefile' || info.layers?.length !== 1) {
        throw new LayerImportValidationError(
            'SHAPEFILE_DRIVER_INVALID',
            'Nguồn không phải một Shapefile hợp lệ',
        );
    }
    const layer = info.layers[0];
    const geometry = layer.geometryFields?.[0];
    const epsg = geometry?.coordinateSystem?.projjson?.id;
    if (epsg?.authority !== 'EPSG' || !Number.isInteger(Number(epsg.code))) {
        throw new LayerImportValidationError(
            'SHAPEFILE_CRS_UNKNOWN',
            'Shapefile thiếu CRS EPSG xác định',
        );
    }
    if (!geometry?.type || geometry.type === 'Unknown (any)') {
        throw new LayerImportValidationError(
            'SHAPEFILE_GEOMETRY_UNKNOWN',
            'Không xác định được loại hình học',
        );
    }
    return {
        sourceSrid: Number(epsg.code),
        sourceGeometry: geometry.type,
        sourceCount: Number(layer.featureCount || 0),
    };
};

const importShapefileToStaging = async (job, filePath, stagingTable) => {
    const input = job.input_payload;
    const archive = inspectShapefileZip(filePath);
    const normalizedZip = path.resolve(filePath).replaceAll('\\', '/');
    const source = `/vsizip/{${normalizedZip}}/${archive.shapefilePath}`;
    const metadata = parseShapefileMetadata(await inspectSource(source));
    await assertSridExists(metadata.sourceSrid);
    await assertSridExists(input.targetSrid);
    if (!archive.cpgPath && !input.sourceEncoding) {
        throw new LayerImportValidationError(
            'DBF_ENCODING_REQUIRED',
            'Shapefile thiếu .cpg; phải gửi sourceEncoding',
        );
    }
    if (input.sourceEncoding && !SOURCE_ENCODINGS.has(input.sourceEncoding)) {
        throw new LayerImportValidationError(
            'DBF_ENCODING_INVALID',
            'DBF encoding không được hỗ trợ',
        );
    }
    const args = [
        '-f',
        'PostgreSQL',
        postgresDatasource(),
        source,
        '-nln',
        `gis.${stagingTable}`,
        '-overwrite',
        '-preserve_fid',
        '-lco',
        'FID=source_fid',
        '-lco',
        'GEOMETRY_NAME=geom',
        '-nlt',
        'PROMOTE_TO_MULTI',
        '-t_srs',
        `EPSG:${input.targetSrid}`,
        '--config',
        'OGR_TRUNCATE',
        'NO',
    ];
    if (input.sourceEncoding) {
        args.push('--config', 'SHAPE_ENCODING', input.sourceEncoding);
    }
    await runTool(getTool('GDAL_OGR2OGR_PATH', 'ogr2ogr'), args);
    return { ...metadata, targetSrid: input.targetSrid };
};

const inspectExcel = async (filePath, input) => {
    const info = await inspectSource(filePath, null, ['HEADERS=FORCE']);
    if (info.driverShortName !== 'XLSX') {
        throw new LayerImportValidationError(
            'XLSX_DRIVER_INVALID',
            'Nguồn không phải workbook XLSX hợp lệ',
        );
    }
    const sheet = info.layers?.find((layer) => layer.name === input.sheetName);
    if (!sheet) {
        throw new LayerImportValidationError(
            'XLSX_SHEET_NOT_FOUND',
            'Không tìm thấy sheet đã chọn',
        );
    }
    const fields = new Set((sheet.fields || []).map((field) => field.name));
    if (!fields.has(input.xColumn) || !fields.has(input.yColumn)) {
        throw new LayerImportValidationError(
            'XLSX_COORDINATE_COLUMN_NOT_FOUND',
            'Không tìm thấy cột tọa độ đã chọn',
        );
    }
    return { sourceCount: Number(sheet.featureCount || 0) };
};

const importExcelToStaging = async (job, filePath, stagingTable) => {
    const input = job.input_payload;
    const metadata = await inspectExcel(filePath, input);
    await assertSridExists(input.sourceSrid);
    await assertSridExists(input.targetSrid);
    await runTool(getTool('GDAL_OGR2OGR_PATH', 'ogr2ogr'), [
        '-f',
        'PostgreSQL',
        postgresDatasource(),
        filePath,
        input.sheetName,
        '-nln',
        `gis.${stagingTable}`,
        '-overwrite',
        '-preserve_fid',
        '-nlt',
        'NONE',
        '-oo',
        'HEADERS=FORCE',
        '-lco',
        'FID=source_row',
        '--config',
        'OGR_TRUNCATE',
        'NO',
    ]);
    const table = quoteIdentifier(stagingTable);
    const x = quoteSourceField(input.xColumn);
    const y = quoteSourceField(input.yColumn);
    const client = await db.getClient();
    try {
        await client.query('BEGIN');
        await client.query(`SET LOCAL statement_timeout = '${DB_TIMEOUT_MS}ms'`);
        const { rows } = await client.query(
            `WITH parsed AS (
                SELECT source_row,
                       CASE WHEN pg_input_is_valid(${x}::text, 'double precision') THEN ${x}::double precision END AS x,
                       CASE WHEN pg_input_is_valid(${y}::text, 'double precision') THEN ${y}::double precision END AS y
                FROM gis.${table}
             )
             SELECT source_row, x, y
             FROM parsed
             WHERE x IS NULL OR y IS NULL
                OR x::text IN ('NaN','Infinity','-Infinity') OR y::text IN ('NaN','Infinity','-Infinity')
                OR ABS(x) > 1e15 OR ABS(y) > 1e15
                OR ($1 = 4326 AND (x < -180 OR x > 180 OR y < -90 OR y > 90))
             ORDER BY source_row LIMIT $2`,
            [input.sourceSrid, ERROR_LIMIT + 1],
        );
        if (rows.length) {
            throw new LayerImportValidationError(
                'XLSX_COORDINATE_INVALID',
                'Excel có tọa độ không hợp lệ',
                rows.slice(0, ERROR_LIMIT).map((row) => ({
                    sourceRow: Number(row.source_row) + 2,
                    code: 'INVALID_COORDINATE',
                    message: 'Tọa độ X/Y không hợp lệ',
                    details: { x: row.x, y: row.y },
                })),
            );
        }
        await client.query(
            `ALTER TABLE gis.${table} ADD COLUMN geom geometry(Point, ${Number(input.targetSrid)})`,
        );
        await client.query(
            `UPDATE gis.${table}
             SET geom = ST_Transform(ST_SetSRID(ST_MakePoint(${x}::double precision, ${y}::double precision), $1::integer), $2::integer)`,
            [input.sourceSrid, input.targetSrid],
        );
        await client.query(`CREATE INDEX ON gis.${table} USING GIST (geom)`);
        await client.query('COMMIT');
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
    return {
        sourceCount: metadata.sourceCount,
        sourceSrid: input.sourceSrid,
        targetSrid: input.targetSrid,
        sourceGeometry: 'Point',
    };
};

const validateSpatialStaging = async (job, stagingTable) => {
    const table = quoteIdentifier(stagingTable);
    const rowId = job.import_type === 'excel' ? 'source_row' : 'source_fid';
    const { rows: invalid } = await db.query(
        `SELECT ${rowId} AS source_row,
                CASE WHEN geom IS NULL THEN 'Geometry is null'
                     WHEN ST_IsEmpty(geom) THEN 'Geometry is empty'
                     ELSE ST_IsValidReason(geom) END AS reason
         FROM gis.${table}
         WHERE geom IS NULL OR ST_IsEmpty(geom) OR NOT ST_IsValid(geom)
         ORDER BY ${rowId} LIMIT $1`,
        [ERROR_LIMIT + 1],
    );
    if (invalid.length) {
        throw new LayerImportValidationError(
            'GEOMETRY_INVALID',
            'Dữ liệu có hình học không hợp lệ',
            invalid.slice(0, ERROR_LIMIT).map((row) => ({
                sourceRow: Number(row.source_row),
                code: 'INVALID_GEOMETRY',
                message: row.reason,
            })),
        );
    }
    const { rows: duplicates } = await db.query(
        `SELECT source_row FROM (
            SELECT ${rowId} AS source_row,
                   ROW_NUMBER() OVER (PARTITION BY ST_AsEWKB(geom) ORDER BY ${rowId}) AS duplicate_number
            FROM gis.${table}
         ) q WHERE duplicate_number > 1 ORDER BY source_row LIMIT $1`,
        [ERROR_LIMIT + 1],
    );
    if (duplicates.length) {
        throw new LayerImportValidationError(
            'GEOMETRY_DUPLICATE',
            'Dữ liệu có hình học trùng hoàn toàn',
            duplicates.slice(0, ERROR_LIMIT).map((row) => ({
                sourceRow: Number(row.source_row),
                code: 'DUPLICATE_GEOMETRY',
                message: 'Hình học trùng hoàn toàn với dòng trước',
            })),
        );
    }
    const {
        rows: [summary],
    } = await db.query(
        `SELECT COUNT(*)::bigint AS feature_count,
                UPPER(REPLACE(MIN(ST_GeometryType(geom)), 'ST_', '')) AS geometry_type,
                COUNT(DISTINCT ST_GeometryType(geom))::int AS type_count,
                MIN(ST_SRID(geom)) AS srid
         FROM gis.${table}`,
    );
    if (!Number(summary.feature_count)) {
        throw new LayerImportValidationError('LAYER_EMPTY', 'Lớp không có đối tượng');
    }
    if (summary.type_count !== 1) {
        throw new LayerImportValidationError('GEOMETRY_TYPE_MIXED', 'Lớp có nhiều loại hình học');
    }
    if (
        job.input_payload.topologyProfile === 'administrative_boundary' &&
        !['POLYGON', 'MULTIPOLYGON'].includes(summary.geometry_type)
    ) {
        throw new LayerImportValidationError(
            'BOUNDARY_GEOMETRY_INVALID',
            'Ranh giới hành chính phải là polygon',
        );
    }
    if (job.input_payload.topologyProfile === 'administrative_boundary') {
        const { rows: overlaps } = await db.query(
            `SELECT a.${rowId} AS source_row, b.${rowId} AS other_row
             FROM gis.${table} a JOIN gis.${table} b ON a.${rowId} < b.${rowId}
             WHERE ST_Overlaps(a.geom, b.geom)
             ORDER BY a.${rowId}, b.${rowId} LIMIT $1`,
            [ERROR_LIMIT + 1],
        );
        if (overlaps.length) {
            throw new LayerImportValidationError(
                'POLYGON_OVERLAP',
                'Ranh giới hành chính có polygon chồng lấn',
                overlaps.slice(0, ERROR_LIMIT).map((row) => ({
                    sourceRow: Number(row.source_row),
                    code: 'POLYGON_OVERLAP',
                    message: `Chồng lấn dòng ${row.other_row}`,
                })),
            );
        }
        const {
            rows: [gap],
        } = await db.query(
            `WITH coverage AS (SELECT ST_UnaryUnion(ST_Collect(geom)) AS geom FROM gis.${table})
             SELECT ST_Area(ST_Difference(ST_ConvexHull(geom), geom)) AS area,
                    ST_Area(geom) AS coverage_area
             FROM coverage`,
        );
        if (Number(gap.area) > Math.max(1e-6, Number(gap.coverage_area) * 1e-8)) {
            throw new LayerImportValidationError(
                'POLYGON_GAP',
                'Ranh giới hành chính có khoảng trống topology',
            );
        }
    }
    return {
        featureCount: Number(summary.feature_count),
        geometryType: summary.geometry_type,
        targetSrid: summary.srid,
    };
};

const promoteStaging = async (job, workerId, stagingTable, summary) => {
    const input = job.input_payload;
    const finalTable = generatedTable('layer', job);
    const staging = quoteIdentifier(stagingTable);
    const final = quoteIdentifier(finalTable);
    const client = await db.getClient();
    try {
        await client.query('BEGIN');
        await client.query(`SET LOCAL statement_timeout = '${DB_TIMEOUT_MS}ms'`);
        await client.query(`ALTER TABLE gis.${staging} RENAME TO ${final}`);
        const {
            rows: [layer],
        } = await client.query(
            `INSERT INTO gis.layers
                (code, name_vi, category, geometry_type, srid, storage_kind, table_name, object_key,
                 is_public, source_file_id, publish_status, metadata, created_by)
             VALUES ($1, $2, $3, $4, $5, 'postgis', $6, $7, $8, $9, 'pending', $10::jsonb, $11)
             RETURNING *`,
            [
                input.code,
                input.nameVi,
                input.category,
                summary.geometryType,
                summary.targetSrid,
                finalTable,
                job.object_key,
                input.isPublic,
                job.file_object_id,
                JSON.stringify({ importType: job.import_type }),
                job.owner_user_id,
            ],
        );
        await client.query(
            `INSERT INTO gis.layer_permissions
                (layer_id, role_code, can_view, can_export, can_edit, can_delete)
             SELECT $1, code,
                    CASE WHEN code = 'so_tnmt' THEN true ELSE $2 END,
                    CASE WHEN code = 'so_tnmt' THEN true ELSE false END,
                    code = 'so_tnmt', code = 'so_tnmt'
             FROM auth.roles WHERE is_active = true`,
            [layer.id, input.isPublic],
        );
        const completed = await client.query(
            `UPDATE gis.layer_import_jobs
             SET status = 'succeeded', progress = 100, layer_id = $3, feature_count = $4,
                 geometry_type = $5, source_srid = $6, target_srid = $7,
                 finished_at = NOW(), worker_id = NULL, lease_expires_at = NULL
             WHERE id = $1 AND status = 'running' AND worker_id = $2
               AND lease_expires_at > NOW()`,
            [
                job.id,
                workerId,
                layer.id,
                summary.featureCount,
                summary.geometryType,
                summary.sourceSrid,
                summary.targetSrid,
            ],
        );
        if (completed.rowCount !== 1) {
            throw new LayerImportValidationError(
                'WORKER_LEASE_LOST',
                'Worker mất lease trước khi promote lớp',
            );
        }
        await client.query('COMMIT');
        return layer;
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
};

const dropStaging = async (stagingTable) => {
    if (!IDENTIFIER.test(stagingTable)) {
        return;
    }
    await db.query(`DROP TABLE IF EXISTS gis.${quoteIdentifier(stagingTable)}`).catch(() => {});
};

const executeImport = async (job) => {
    const stagingTable = generatedTable('staging', job);
    const workRoot = path.resolve(
        process.env.LAYER_WORK_DIR || path.join(process.cwd(), '.runtime', 'layer-worker'),
    );
    fs.mkdirSync(workRoot, { recursive: true, mode: 0o700 });
    const workDir = fs.mkdtempSync(path.join(workRoot, `job-${job.id}-`));
    try {
        const extension = job.import_type === 'shapefile' ? '.zip' : '.xlsx';
        const sourcePath = path.join(workDir, `source${extension}`);
        await minioService.downloadToFile({
            objectKey: job.object_key,
            category: 'layers',
            destPath: sourcePath,
        });
        const metadata =
            job.import_type === 'shapefile'
                ? await importShapefileToStaging(job, sourcePath, stagingTable)
                : await importExcelToStaging(job, sourcePath, stagingTable);
        const summary = await validateSpatialStaging(job, stagingTable);
        const layer = await promoteStaging(job, job.worker_id, stagingTable, {
            ...summary,
            sourceSrid: metadata.sourceSrid,
        });
        try {
            const geoserverLayer = await geoserverClient.publishVectorLayer({
                ...layer,
                epsg_code: layer.srid,
            });
            await layerRepository.setPublishState(layer.id, 'published', geoserverLayer);
        } catch {
            await layerRepository.setPublishState(layer.id, 'failed');
        }
        return {
            layerId: layer.id,
            featureCount: summary.featureCount,
            geometryType: summary.geometryType,
            sourceSrid: metadata.sourceSrid,
            targetSrid: summary.targetSrid,
        };
    } catch (error) {
        await dropStaging(stagingTable);
        if (error.code === '23505') {
            throw new LayerImportValidationError(
                'LAYER_CODE_CONFLICT',
                'Mã lớp hoặc bảng lớp đã tồn tại',
            );
        }
        if (error instanceof Api422Error) {
            throw new LayerImportValidationError(
                error.errors?.[0] || 'ARCHIVE_INVALID',
                error.message,
            );
        }
        throw error;
    } finally {
        fs.rmSync(workDir, { recursive: true, force: true });
    }
};

module.exports = {
    LayerImportValidationError,
    quoteIdentifier,
    runTool,
    inspectSource,
    inspectExcel,
    parseShapefileMetadata,
    importShapefileToStaging,
    importExcelToStaging,
    validateSpatialStaging,
    promoteStaging,
    executeImport,
};
