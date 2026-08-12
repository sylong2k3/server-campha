'use strict';

/**
 * =============================================================================
 * FOREST CLASSIFICATION — DISTRICT RASTER EXPORT
 * =============================================================================
 * Chạy background sau khi snapshot completed:
 *   - Loop từng đơn vị hành chính Cẩm Phả
 *   - Với mỗi huyện: getDownloadURL từ GEE với clip theo geometry huyện
 *   - Auto-enqueue raster-ingest để upload MinIO + publish GeoServer
 *   - Update forest_district_exports row với url + area stats
 *
 * Trước đây nằm trong forest-classification.service.js (line 501-688). Tách vì:
 *   - độc lập với analysis chính (chạy async trong worker)
 *   - có sub-flow auto-ingest riêng
 * =============================================================================
 */

const cfg = require('../configs/forest-classification');
const { ee } = require('../configs/gge');
const repo = require('../repositories/forest-classification.repository');
const { parseInteger } = require('../../shared-utils/env');

const CLASSIFIED_VIZ = {
  bands: ['classification'],
  min: 0,
  max: cfg.CLASS_NAMES.length - 1,
  palette: cfg.CLASS_PALETTE,
};

/**
 * Export raster huyện tuần tự (serial) — GEE quota tránh burst.
 * Mỗi huyện: getDownloadURL → auto-ingest MinIO/GeoServer.
 */
async function runForestDistrictRasterExport({
  snapshot,
  year,
  month,
  districtGeoJson,
  areaByDistrict,
  classifiedForDownload,
  seededDistrictExports,
  provinceSummary,
}) {
  const tag = `${year}${String(month).padStart(2, '0')}`;
  const rowByCode = new Map();
  for (const row of seededDistrictExports) {
    rowByCode.set(String(row.district_code || ''), row);
  }

  const counters = { completed: 0, failed: 0, skipped: 0 };
  const total = seededDistrictExports.length;
  const totalForestHa = cfg.FOREST_CLASS_IDS.reduce(
    (sum, classId) => sum + Number(provinceSummary.byClass?.[classId] || 0),
    0,
  );

  const persistSummary = () => repo.updateDistrictExportSummary(snapshot.id, {
    scaleM: cfg.DOWNLOAD_SCALE_M,
    total,
    ...counters,
    pending: Math.max(0, total - counters.completed - counters.failed - counters.skipped),
    totalHa: provinceSummary.totalHa,
    forestHa: Math.round(totalForestHa * 100) / 100,
    byClass: provinceSummary.byClass || {},
  });

  console.info(
    `[FOREST-EXPORT] START snapshot=${snapshot.id} `
      + `period=${year}-${String(month).padStart(2, '0')} districts=${total}`,
  );

  for (const district of districtGeoJson) {
    const code = String(district.ADM2_CODE || '');
    const row = rowByCode.get(code);
    if (!row) {
      console.warn(
        `[FOREST-EXPORT] snapshot=${snapshot.id} district=${code || 'null'} `
          + 'không có district_export row',
      );
      continue;
    }

    const startedAt = Date.now();
    await repo.updateDistrictExport(row.id, {
      status: 'computing',
      started_at: new Date(),
      error_message: null,
    });

    const bag = areaByDistrict.get(code) || { byClass: {} };
    const byClass = bag.byClass;
    let totalHa = 0;
    let forestHa = 0;
    for (const [classId, hectares] of Object.entries(byClass)) {
      totalHa += Number(hectares) || 0;
      if (cfg.FOREST_CLASS_IDS.includes(Number(classId))) {
        forestHa += Number(hectares) || 0;
      }
    }

    // Skip huyện không có pixel classified (thường do quá bé hoặc geometry lỗi)
    if (totalHa === 0) {
      await repo.updateDistrictExport(row.id, {
        status: 'skipped',
        area_by_class: byClass,
        total_area_ha: 0,
        forest_area_ha: 0,
        duration_ms: Date.now() - startedAt,
        completed_at: new Date(),
        error_message: 'no pixels classified',
      });
      counters.skipped += 1;
      await persistSummary();
      continue;
    }

    const fileBase = `forest_class_${code}_${tag}`;
    try {
      const districtGeom = district.epsg && district.epsg !== 4326
        ? ee.Geometry(district.geometry, `EPSG:${district.epsg}`, false)
        : ee.Geometry(district.geometry);
      const timeoutMs = parseInteger(process.env.FC_DOWNLOAD_TIMEOUT_MS, 5 * 60_000);

      const url = await new Promise((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error(
            `getDownloadURL timeout huyện=${code} sau ${timeoutMs}ms`,
          )),
          timeoutMs,
        );
        classifiedForDownload
          .updateMask(classifiedForDownload.gt(0))
          .visualize(CLASSIFIED_VIZ)
          .clip(districtGeom)
          .getDownloadURL(
            {
              name: fileBase,
              scale: cfg.DOWNLOAD_SCALE_M || 150,
              region: districtGeom,
              crs: 'EPSG:4326',
              format: 'GEO_TIFF',
              filePerBand: false,
              maxPixels: 1e9,
            },
            (downloadUrl, error) => {
              clearTimeout(timer);
              if (error) {
                reject(new Error(String(error.message || error)));
              } else {
                resolve(downloadUrl);
              }
            },
          );
      });

      await repo.updateDistrictExport(row.id, {
        status: 'completed',
        area_by_class: byClass,
        total_area_ha: Math.round(totalHa * 100) / 100,
        forest_area_ha: Math.round(forestHa * 100) / 100,
        gee_download_url: url,
        gee_download_filename: `${fileBase}.zip`,
        gee_generated_at: new Date(),
        duration_ms: Date.now() - startedAt,
        completed_at: new Date(),
        error_message: null,
      });
      counters.completed += 1;

      // Auto-enqueue raster ingest (non-blocking, log warn if failed)
      await autoIngestDistrict(snapshot, {
        exportId: row.id,
        code,
        name: district.ADM2_NAME,
        url,
        byClass,
        totalHa,
        forestHa,
      }, year, month).catch((error) => {
        console.warn(
          `[FOREST-EXPORT] auto-ingest district=${code} `
            + `failed (export vẫn completed): ${error.message}`,
        );
      });
    } catch (error) {
      console.warn(
        `[FOREST-EXPORT] snapshot=${snapshot.id} district=${code} `
          + `failed: ${error.message}`,
      );
      await repo.updateDistrictExport(row.id, {
        status: 'failed',
        area_by_class: byClass,
        total_area_ha: Math.round(totalHa * 100) / 100,
        forest_area_ha: Math.round(forestHa * 100) / 100,
        error_message: error.message,
        duration_ms: Date.now() - startedAt,
        completed_at: new Date(),
      });
      counters.failed += 1;
    }

    await persistSummary();
    console.info(
      `[FOREST-EXPORT] PROGRESS snapshot=${snapshot.id} `
        + `completed=${counters.completed} failed=${counters.failed} `
        + `skipped=${counters.skipped}/${total}`,
    );
  }

  const summary = await persistSummary();
  console.info(
    `[FOREST-EXPORT] DONE snapshot=${snapshot.id} `
      + `completed=${counters.completed} failed=${counters.failed} `
      + `skipped=${counters.skipped}/${total}`,
  );
  return summary;
}

/**
 * Auto-enqueue raster-ingest cho 1 huyện. Sau khi enqueue, update
 * forest_district_exports.raster_ingest_job_id để trace.
 */
async function autoIngestDistrict(snapshot, districtRow, year, month) {
  if (!districtRow?.url) {return;}
  // Lazy require để tránh circular (raster-ingest có thể lookup forest snapshot)
  const ingestSvc = require('./raster-ingest.service');
  const tag = `${year}${String(month).padStart(2, '0')}`;
  const code = districtRow.code || 'unknown';
  const layerCode = `forest_class_${code}_${tag}_s${snapshot.id}`;

  console.log(
    `[FOREST-CLS] auto-ingest district=${code} enqueue snapshot=${snapshot.id} layer=${layerCode}`,
  );

  const { job, deduplicated } = await ingestSvc.enqueue({
    sourceUrl: districtRow.url,
    layerCode,
    nameVi: `Phân loại rừng ${year}-${String(month).padStart(2, '0')} — ${districtRow.name || code}`,
    isPublic: true,
    category: 'forest_district',
    requestParams: {
      bucketCategory: 'forest-classification',
      linkedResource: { type: 'forest_district', id: snapshot.id, districtCode: code },
      year,
      month,
      scale_m: cfg.DOWNLOAD_SCALE_M || 150,
      autoIngested: true,
      // enqueue() không có param layerGroup riêng, phải nhét vào requestParams
      // để _upsertRasterLayer đọc được job.request_params.layer_group
      layer_group: 'phan_loai_rung',
    },
    user: null,
    lang: 'vi',
  });

  if (job.layer_code !== layerCode) {
    throw new Error(
      `Raster ingest job #${job.id} belongs to ${job.layer_code}, expected ${layerCode}.`,
    );
  }

  if (districtRow.exportId) {
    await repo.updateDistrictExport(districtRow.exportId, {
      raster_ingest_job_id: job.id,
    });
  }

  console.log(
    `[FOREST-CLS] auto-ingest district=${code} ${deduplicated ? 'DEDUPE' : 'ENQUEUED'} → ` +
      `job=${job.id} status=${job.status}`,
  );
}

module.exports = {
  runForestDistrictRasterExport,
  autoIngestDistrict,
  CLASSIFIED_VIZ,
};
