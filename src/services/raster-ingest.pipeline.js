'use strict';

/**
 * Raster ingest — 6-stage pipeline (7 with §22-F CRS validation).
 *
 * Runs one job the worker has already claimed (status='downloading').
 *
 *   Stage 1 (downloading)   → stream fetch to /tmp with in-flight SHA-256
 *   Stage 2 (validating)    → TIFF magic-byte check (§22-G integrity)
 *   Stage 3 (crs_checking)  → gdalinfo --json (§22-F CRS whitelist)
 *   Stage 4 (uploading)     → PUT to MinIO under category='raster'
 *                             (or job.request_params.bucketCategory)
 *   Stage 5 (publishing)    → GeoServer CoverageStore + layer
 *   Stage 6 (registry)      → gis.layer_registry upsert + saveOutput()
 *   Stage 7 (back-link)     → best-effort link to snapshot / district
 *
 * @ported-from migration/kt_gee_migration/services/raster-ingest.pipeline.js
 * @improvements
 *   - §22-F: CRS validation before publish (reference project had none — a
 *            surprise CRS silently rendered wrong in GeoServer)
 *   - §22-G: SHA-256 checksum captured during the download itself
 *   - Every external dependency is DI-swappable so tests don't need the
 *     network / GDAL / GeoServer / MinIO / Postgres
 *   - Bucket resolved per-job via category (no cfg.MINIO_BUCKET fallback)
 *   - A non-COG GeoTIFF is converted with GDAL before it reaches MinIO or
 *     GeoServer. This is required for direct Earth Engine downloads.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

const cfg = require('../configs/raster-ingest');
const { downloadToFile } = require('../utils/http-stream-download.util');
const { isTiffFile } = require('../utils/geotiff.util');
const retryPolicy = require('./raster-ingest.retry');

const DEBUG = process.env.RASTER_INGEST_DEBUG === 'true' || process.env.NODE_ENV === 'development';

const dbg = (tag, msg) => {
    if (DEBUG) {
        console.debug(`[RASTER-INGEST:${tag}] ${new Date().toISOString()} — ${msg}`);
    }
};
const fmtMB = (bytes) => `${(bytes / 1048576).toFixed(2)}MB`;

// EPSG:32648 = UTM 48N (Cẩm Phả analysis CRS); EPSG:4326 is accepted for
// direct Earth Engine downloads and publisher-facing basemaps.
const ALLOWED_CRS = new Set(['EPSG:32648', 'EPSG:4326']);
const DEFAULT_BUCKET_CATEGORY = 'raster';

const PIPELINE_ERROR_CODES = Object.freeze({
    ZIP_NOT_YET_SUPPORTED: 'ZIP_NOT_YET_SUPPORTED',
    NOT_A_TIFF: 'NOT_A_TIFF',
    UNSUPPORTED_CRS: 'UNSUPPORTED_CRS',
    GDALINFO_UNAVAILABLE: 'GDALINFO_UNAVAILABLE',
    GDAL_TRANSLATE_UNAVAILABLE: 'GDAL_TRANSLATE_UNAVAILABLE',
    COG_CONVERSION_FAILED: 'COG_CONVERSION_FAILED',
    NOT_A_COG: 'NOT_A_COG',
});

// ── Small helpers ─────────────────────────────────────────────────────────────

const sha256File = (filePath) =>
    new Promise((resolve, reject) => {
        const hasher = crypto.createHash('sha256');
        fs.createReadStream(filePath)
            .on('data', (chunk) => hasher.update(chunk))
            .on('end', () => resolve(hasher.digest('hex')))
            .on('error', reject);
    });

const buildObjectKey = (job, tag, bucketCategory = DEFAULT_BUCKET_CATEGORY) => {
    const now = new Date();
    const yyyy = now.getUTCFullYear();
    const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
    const categoryPrefix = String(bucketCategory || DEFAULT_BUCKET_CATEGORY)
        .replace(/[^a-z0-9_-]/gi, '_')
        .toLowerCase();
    const safeCode = String(job.layer_code || 'job')
        .replace(/[^a-z0-9_-]/gi, '_')
        .toLowerCase();
    return `${categoryPrefix}/${yyyy}/${mm}/${safeCode}/${tag}.tif`;
};

const cleanup = async (files) => {
    for (const p of files) {
        if (!p) {
            continue;
        }
        await fs.promises.unlink(p).catch(() => {});
    }
};

// Default GDAL-based CRS validator (§22-F). Injectable so tests never need GDAL.
async function defaultValidateCrs(tifPath) {
    return new Promise((resolve, reject) => {
        const gdalinfo = spawn('gdalinfo', ['-json', tifPath]);
        let stdout = '';
        let stderr = '';
        gdalinfo.stdout.on('data', (b) => {
            stdout += b.toString();
        });
        gdalinfo.stderr.on('data', (b) => {
            stderr += b.toString();
        });
        gdalinfo.once('error', (err) => {
            const wrap = new Error(
                `gdalinfo not available for CRS validation (${err.code || err.message})`,
            );
            wrap.code = PIPELINE_ERROR_CODES.GDALINFO_UNAVAILABLE;
            reject(wrap);
        });
        gdalinfo.once('close', (exitCode) => {
            if (exitCode !== 0) {
                const wrap = new Error(`gdalinfo exit=${exitCode} stderr=${stderr.slice(0, 200)}`);
                wrap.code = PIPELINE_ERROR_CODES.GDALINFO_UNAVAILABLE;
                reject(wrap);
                return;
            }
            try {
                const parsed = JSON.parse(stdout);
                // Prefer coordinateSystem.epsgCode; fall back to matching WKT.
                const epsg = parsed?.coordinateSystem?.dataAxisToSRSAxisMapping
                    ? extractEpsgFromWkt(parsed?.coordinateSystem?.wkt)
                    : extractEpsgFromWkt(parsed?.coordinateSystem?.wkt);
                const geoTransform = parsed?.geoTransform || [];
                const size = parsed?.size || [];
                const corners = parsed?.cornerCoordinates || {};
                resolve({
                    crs: epsg,
                    raw: parsed?.coordinateSystem,
                    isCog: parsed?.metadata?.IMAGE_STRUCTURE?.LAYOUT === 'COG',
                    width: size[0] || null,
                    height: size[1] || null,
                    resolutionM: Number.isFinite(Math.abs(geoTransform[1]))
                        ? Math.abs(geoTransform[1])
                        : null,
                    bbox:
                        corners.lowerLeft && corners.upperRight
                            ? {
                                  minX: corners.lowerLeft[0],
                                  minY: corners.lowerLeft[1],
                                  maxX: corners.upperRight[0],
                                  maxY: corners.upperRight[1],
                              }
                            : null,
                    bandCount: Array.isArray(parsed?.bands) ? parsed.bands.length : null,
                    dataType: parsed?.bands?.[0]?.type || null,
                    nodata: parsed?.bands?.[0]?.noDataValue ?? null,
                });
            } catch (err) {
                reject(err);
            }
        });
    });
}

async function defaultConvertToCog(sourcePath, cogPath) {
    return new Promise((resolve, reject) => {
        const gdalTranslate = spawn('gdal_translate', [
            '-of',
            'COG',
            '-co',
            'COMPRESS=DEFLATE',
            '-co',
            'BIGTIFF=IF_SAFER',
            sourcePath,
            cogPath,
        ]);
        let stderr = '';
        gdalTranslate.stderr.on('data', (chunk) => {
            stderr += chunk.toString();
        });
        gdalTranslate.once('error', (error) => {
            const wrapped = new Error(
                `gdal_translate not available for COG conversion (${error.code || error.message})`,
            );
            wrapped.code = PIPELINE_ERROR_CODES.GDAL_TRANSLATE_UNAVAILABLE;
            reject(wrapped);
        });
        gdalTranslate.once('close', (exitCode) => {
            if (exitCode === 0) {
                resolve();
                return;
            }
            const wrapped = new Error(
                `gdal_translate COG conversion failed (exit=${exitCode}): ${stderr.slice(0, 500)}`,
            );
            wrapped.code = PIPELINE_ERROR_CODES.COG_CONVERSION_FAILED;
            reject(wrapped);
        });
    });
}

function extractEpsgFromWkt(wkt) {
    if (!wkt || typeof wkt !== 'string') {
        return null;
    }
    // Match the innermost ID["EPSG",<code>] block (last authority in the WKT tree).
    const matches = [...wkt.matchAll(/ID\["EPSG",(\d+)\]/g)];
    if (matches.length === 0) {
        return null;
    }
    return `EPSG:${matches[matches.length - 1][1]}`;
}

// ── Injected-dep resolver ─────────────────────────────────────────────────────

function loadDefaults() {
    let repo = null;
    let minio = null;
    let publisher = null;
    try {
        repo = require('../repositories/raster-ingest.repository');
    } catch {
        /* pre-GEE-S05 */
    }
    try {
        minio = require('./minio.service');
    } catch {
        /* very early boot */
    }
    try {
        publisher = require('./raster-ingest.publish');
    } catch {
        /* not yet ported */
    }
    return { repo, minio, publisher };
}

// ── Public: runJob ────────────────────────────────────────────────────────────

/**
 * Execute one claimed job through all stages. Never returns — either resolves
 * with `{ objectKey, geoserverLayer, sha256 }` or rejects (retry policy has
 * already recorded the failure via repo.updateStatus / repo.moveToDlq).
 *
 * @param {object} job — DB row (id, layer_code, source_url, retry_count, request_params)
 * @param {object} [deps]
 * @param {object} [deps.repo]        — raster-ingest.repository (DI)
 * @param {object} [deps.minio]       — minio.service (DI)
 * @param {object} [deps.publisher]   — raster-ingest.publish (DI)
 * @param {Function} [deps.download]  — downloadToFile override
 * @param {Function} [deps.validateCrs] — override for §22-F check
 * @param {Function} [deps.sha256File] — override checksum helper (test speed)
 */
async function runJob(job, deps = {}) {
    if (!job || !job.id) {
        throw new Error('runJob requires a job row with an id');
    }
    const defaults = loadDefaults();
    const repo = 'repo' in deps ? deps.repo : defaults.repo;
    const minio = 'minio' in deps ? deps.minio : defaults.minio;
    const publisher = 'publisher' in deps ? deps.publisher : defaults.publisher;
    const download = deps.download || downloadToFile;
    const validateCrs = deps.validateCrs || defaultValidateCrs;
    const convertToCog = deps.convertToCog || defaultConvertToCog;
    const computeSha256 = deps.sha256File || sha256File;

    if (!repo) {
        throw new Error('raster-ingest pipeline needs a repository');
    }

    const jobStart = Date.now();
    await fs.promises.mkdir(cfg.TMP_DIR, { recursive: true });

    const tag = `job_${job.id}`;
    const rawPath = path.join(cfg.TMP_DIR, `${tag}.raw`);
    const cogPath = path.join(cfg.TMP_DIR, `${tag}.tif`);
    const params = job.request_params || {};
    let convertedPath = null;

    console.info(
        `[RASTER-INGEST] job=${job.id} START layer=${job.layer_code} ` +
            `retry=${job.retry_count}/${cfg.MAX_RETRIES}`,
    );

    try {
        // ── Stage 1: Download ─────────────────────────────────────────
        const t1 = Date.now();
        dbg('DOWNLOAD', `→ ${rawPath}`);
        const dl = await download(job.source_url, rawPath, {
            timeoutMs: cfg.FETCH_TIMEOUT_MS,
            maxBytes: cfg.MAX_BYTES,
        });
        dbg(
            'DOWNLOAD',
            `bytes=${fmtMB(dl.bytes)} sha=${dl.sha256.slice(0, 12)}… (${Date.now() - t1}ms)`,
        );
        await repo.updateStatus(job.id, { status: 'validating', progress: 30 });

        // ── Stage 2: Format validate (§22-G) ─────────────────────────
        // Flood-domain exports produce a single GeoTIFF. ZIP support (needed
        // for the reference project's per-band exports) is deferred.
        const looksLikeTiff = await isTiffFile(rawPath);
        if (!looksLikeTiff) {
            // Peek the first 4 bytes to give the caller a useful classification.
            const buf = Buffer.alloc(4);
            const fd = await fs.promises.open(rawPath, 'r');
            try {
                await fd.read(buf, 0, 4, 0);
            } finally {
                await fd.close();
            }
            const isZip = buf.equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
            const code = isZip
                ? PIPELINE_ERROR_CODES.ZIP_NOT_YET_SUPPORTED
                : PIPELINE_ERROR_CODES.NOT_A_TIFF;
            const err = new Error(
                isZip
                    ? 'ZIP payloads not yet supported by this pipeline (pending gee-zip-rgb util)'
                    : 'downloaded artifact is not a TIFF (magic-byte mismatch)',
            );
            err.code = code;
            throw err;
        }
        // For a single-TIFF payload the "cog" IS the downloaded file. A future
        // ZIP handler would produce a fresh cogPath at this point.
        await fs.promises.rename(rawPath, cogPath);
        let cog = { size: dl.bytes, sha256FromDownload: dl.sha256, mode: 'passthrough' };

        // ── Stage 3: CRS validate (§22-F) ────────────────────────────
        // CRS/COG validation is a publication safety gate. A host without
        // GDAL must fail closed instead of publishing a spatially unknown raster.
        let crsInfo = await validateCrs(cogPath);
        if (!crsInfo?.crs || !ALLOWED_CRS.has(crsInfo.crs)) {
            const err = new Error(
                `Unexpected CRS ${crsInfo?.crs || 'unknown'} for raster; expected one of ${[...ALLOWED_CRS].join(', ')}`,
            );
            err.code = PIPELINE_ERROR_CODES.UNSUPPORTED_CRS;
            throw err;
        }
        if (crsInfo.isCog === false) {
            // Direct getDownloadURL results are regular GeoTIFFs. Convert the
            // temporary file before archiving so MinIO and GeoServer receive a COG.
            convertedPath = `${cogPath}.converted`;
            await convertToCog(cogPath, convertedPath);
            await fs.promises.unlink(cogPath);
            await fs.promises.rename(convertedPath, cogPath);
            crsInfo = await validateCrs(cogPath);
            if (crsInfo.isCog === false) {
                const err = new Error('GDAL conversion did not produce a Cloud Optimized GeoTIFF');
                err.code = PIPELINE_ERROR_CODES.NOT_A_COG;
                throw err;
            }
            const { size } = await fs.promises.stat(cogPath);
            cog = { size, mode: 'cog-converted' };
        }
        dbg('CRS', `ok crs=${crsInfo.crs}`);

        await repo.updateStatus(job.id, { status: 'uploading', progress: 55 });

        // ── Stage 4: Upload to MinIO (streaming) ─────────────────────
        if (!minio) {
            throw new Error('minio.service unavailable for upload');
        }
        const t4 = Date.now();
        const category = params.bucketCategory || DEFAULT_BUCKET_CATEGORY;
        const objectKey = buildObjectKey(job, tag, category);
        // We already have the sha256 from the download for a passthrough
        // COG; skip a second full-file hash unless the caller passed a
        // conversion mode that changed the bytes.
        const sha = cog.mode === 'passthrough' ? dl.sha256 : await computeSha256(cogPath);
        await minio.uploadStream({
            stream: fs.createReadStream(cogPath),
            objectKey,
            mimeType: 'image/tiff',
            fileSize: cog.size,
            category,
        });
        dbg('UPLOAD', `bucket-category=${category} key=${objectKey} (${Date.now() - t4}ms)`);
        await repo.updateStatus(job.id, { status: 'publishing', progress: 80 });

        // ── Stage 5: Publish to GeoServer (product runs only) ────────
        if (!publisher) {
            throw new Error('raster-ingest.publish module unavailable');
        }
        const t5 = Date.now();
        const storeName = job.layer_code;
        const shouldPublish = params.publish !== false;
        let geoserverLayer = null;
        let isReingest = false;
        if (shouldPublish) {
            const published = await publisher.publishToGeoServer({ storeName, cogPath, params });
            geoserverLayer = published.geoserverLayer;
            isReingest = published.isReingest;
            dbg('PUBLISH', `→ ${geoserverLayer} reingest=${isReingest} (${Date.now() - t5}ms)`);
        } else {
            dbg('PUBLISH', 'skipped by product/calibration publication policy');
        }

        // ── Stage 6: canonical gis.layers registry upsert + saveOutput ─────
        const t6 = Date.now();
        let layerRowId = null;
        if (shouldPublish) {
            if (typeof publisher.upsertRasterLayer !== 'function') {
                throw new Error(
                    'raster publisher does not implement canonical layer registry upsert',
                );
            }
            const layerRow = await publisher.upsertRasterLayer({
                job,
                params,
                storeName,
                geoserverLayer,
                objectKey,
                sha,
            });
            layerRowId = layerRow?.id || null;
            dbg('REGISTRY', `layer_id=${layerRowId} (${Date.now() - t6}ms)`);
        }
        await repo.saveOutput(job.id, {
            minioCategory: category,
            minioKey: objectKey,
            fileSizeBytes: cog.size,
            fileSha256: sha,
            geoserverStore: storeName,
            geoserverLayer,
            layerId: layerRowId,
        });
        // ── Stage 7: Domain back-link ────────────────────────────────
        if (params.linkedResource && typeof publisher.backLinkResource === 'function') {
            try {
                const linked = await publisher.backLinkResource(params.linkedResource, {
                    geoserverLayer,
                    geoserverStore: storeName,
                    minioCategory: category,
                    minioKey: objectKey,
                    rasterIngestJobId: job.id,
                    sha256: sha,
                    sizeBytes: cog.size,
                    crs: crsInfo?.crs,
                    width: crsInfo?.width,
                    height: crsInfo?.height,
                    resolutionM: crsInfo?.resolutionM,
                    bbox: crsInfo?.bbox,
                    bandCount: crsInfo?.bandCount,
                    dataType: crsInfo?.dataType,
                    published: shouldPublish,
                });
                const failClosedBacklink = [
                    'flood_artifact',
                    'forest_snapshot',
                    'satellite',
                ].includes(params.linkedResource.type);
                if (failClosedBacklink && linked?.rowCount !== 1) {
                    const error = new Error(
                        `${params.linkedResource.type} ${params.linkedResource.id} was not back-linked`,
                    );
                    error.code = 'DOMAIN_BACKLINK_FAILED';
                    throw error;
                }
            } catch (err) {
                if (
                    ['flood_artifact', 'forest_snapshot', 'satellite'].includes(
                        params.linkedResource.type,
                    )
                ) {
                    throw err;
                }
                console.warn(`[RASTER-INGEST] backlink FAILED job=${job.id}: ${err.message}`);
            }
        }
        await repo.updateStatus(job.id, { status: 'completed', progress: 100 });

        console.info(
            `[RASTER-INGEST] job=${job.id} COMPLETED layer=${geoserverLayer} ` +
                `size=${fmtMB(cog.size)} reingest=${isReingest} total=${Date.now() - jobStart}ms`,
        );
        return { objectKey, geoserverLayer, sha256: sha };
    } catch (err) {
        try {
            await retryPolicy.fail(job, err, { repo });
            const failedJob =
                typeof repo.findById === 'function' ? await repo.findById(job.id) : null;
            const linked = job.request_params?.linkedResource;
            if (
                ['flood_artifact', 'forest_snapshot', 'satellite'].includes(linked?.type) &&
                ['failed', 'url_expired', 'dlq'].includes(failedJob?.status) &&
                typeof publisher?.markBackLinkFailed === 'function'
            ) {
                await publisher.markBackLinkFailed(linked, err);
            }
        } catch (retryErr) {
            console.error(`[RASTER-INGEST] retry policy failure: ${retryErr.message}`);
        }
        throw err;
    } finally {
        await cleanup([rawPath, cogPath, convertedPath]);
    }
}

module.exports = {
    runJob,
    // Exposed for tests and admin diagnostics.
    ALLOWED_CRS,
    PIPELINE_ERROR_CODES,
    DEFAULT_BUCKET_CATEGORY,
    sha256File,
    buildObjectKey,
    extractEpsgFromWkt,
    defaultConvertToCog,
};
