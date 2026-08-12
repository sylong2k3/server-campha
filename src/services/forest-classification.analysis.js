'use strict';

/**
 * =============================================================================
 * FOREST CLASSIFICATION — MAIN ANALYSIS ORCHESTRATOR
 * =============================================================================
 * executeAnalysis: 11-stage pipeline (create snapshot → GT query → GEE compute
 * → area stats → GeeMapId → district export seed → notify).
 *
 * runAnalysis: dedupe wrapper qua gee-task queue + optional child process.
 *
 * Trước đây nằm trong forest-classification.service.js (line 199-732, ~530 LOC).
 * =============================================================================
 */

const cfg = require('../configs/forest-classification');
const { initializeEarthEngine } = require('../configs/gge');
const {
  getCamPhaRegion,
  getCamPhaAdministrativeUnits,
  getCamPhaAdministrativeUnitsGeoJson,
  getEeMapId,
  eeEval,
} = require('../utils/gee-satellite.util');
const { runRfClassification } = require('./forest-classification.pipeline');
const { makeStageLogger } = require('../utils/stage-logger.util');
const repo = require('../repositories/forest-classification.repository');
const geeQueue = require('../queues/gee-task.queue');
const districtRasterWorker = require('../workers/districtRasterExport.worker');
const geeAnalysisProcess = require('../workers/geeAnalysisProcess.worker');
const { toPublicProcessingError } = require('../utils/gee-processing-state.util');

const { parseInteger } = require('../../shared-utils/env');
const {
  computeProvinceAreaStats,
  computeDistrictAreaStats,
  sendTop3ChangesAlert,
} = require('./forest-classification.stats');
const {
  runForestDistrictRasterExport,
  CLASSIFIED_VIZ,
} = require('./forest-classification.districts');

const DEBUG = process.env.FC_DEBUG === 'true'
  || process.env.NODE_ENV === 'development';

// ── Main analysis (11-stage) ────────────────────────────────────────────────

async function executeAnalysis(year, month, {
  trigger = 'cron',
  requestedBy = null,
  groundTruthAssetId = process.env.FC_GROUND_TRUTH_ASSET_ID || '',
  gtBufferM = parseInteger(process.env.FC_GT_BUFFER_M, 60),
  minFieldTest = parseInteger(process.env.FC_MIN_FIELD_TEST, 10),
  gtWindowDays = parseInteger(process.env.FC_GT_WINDOW_DAYS, 180),
} = {}) {
  const log = makeStageLogger('FOREST-CLS', {
    correlationId: `${year}-${String(month).padStart(2, '0')}`,
  });
  const startMs = Date.now();

  console.log(
    `[FOREST-CLS] runAnalysis START period=${year}/${month} trigger=${trigger} `
      + `hasGtAsset=${Boolean(groundTruthAssetId)} `
      + `gtWindow=${gtWindowDays}d gtBuffer=${gtBufferM}m minFieldTest=${minFieldTest} `
      + `requestedBy=${requestedBy || 'system'} debug=${DEBUG}`,
  );

  let gtData = { counts: { zones: 0, points: 0, byClass: {} }, zones: { features: [] }, points: { features: [] } };
  let groundTruthGeoJson = null;
  let hasGT = Boolean(groundTruthAssetId);

  let snapshot = await log.run('Create snapshot (new attempt) → status=computing', () =>
    repo.createSnapshot({
      year,
      month,
      status: 'computing',
      trigger,
      requested_by: requestedBy,
      download_scale_m: cfg.DOWNLOAD_SCALE_M,
      model_params: {
        version: 'v3-lite',
        mode: 'lite',
        rf_trees: cfg.LITE_RF_TREES,
        rf_vars_split: cfg.RF_VARIABLES_PER_SPLIT,
        bag_fraction: cfg.RF_BAG_FRACTION,
        samples: cfg.LITE_SAMPLES_PER_CLASS,
        sample_scale_m: cfg.LITE_SAMPLE_SCALE_M,
        area_scale_m: 200,
        download_scale_m: cfg.DOWNLOAD_SCALE_M,
        skip_stats: true,
        ground_truth_asset_id: hasGT ? groundTruthAssetId : null,
        gt_buffer_m: hasGT ? gtBufferM : null,
        blend_rule: cfg.LITE_USE_DATASET_LABELS
          ? (hasGT
            ? 'Input 50% + Dataset 30% + Threshold 20%'
            : 'Dataset 60% + Threshold 40%')
          : (hasGT ? 'Input 50% + Threshold 50%' : 'Threshold 100%'),
      },
    }));

  try {
    await log.run('Initialize Earth Engine session', () => initializeEarthEngine());

    // Ground truth query — snapshot đã tạo → GT fail sẽ đi vào catch bên dưới
    try {
      const gtSvc = require('./forest-gt.service');
      const analysisEndDate = new Date(Date.UTC(year, month, 0));
      gtData = await log.run(
        `Fetch ground truth (window ${gtWindowDays}d before ${analysisEndDate.toISOString().slice(0, 10)})`,
        () => gtSvc.getGtForAnalysis(analysisEndDate, gtWindowDays),
      );
      log.mark('Ground truth',
        `zones=${gtData.counts.zones} points=${gtData.counts.points} byClass=${JSON.stringify(gtData.counts.byClass)}`);
      if (gtData.counts.zones + gtData.counts.points > 0) {
        groundTruthGeoJson = {
          type: 'FeatureCollection',
          features: [...gtData.zones.features, ...gtData.points.features],
        };
        hasGT = true;
      }
    } catch (gtErr) {
      // Migration 033 chưa chạy → 42P01. Không block pipeline
      const code = gtErr.code || gtErr.name || '';
      console.warn(`[FOREST-CLS] GT query FAILED (${code}) — fallback không GT: ${gtErr.message}`);
      log.mark('Ground truth', `SKIPPED (${code}) — chạy migration 033 để enable`);
    }

    const region = await log.run('Load Cẩm Phả region polygon',
      () => Promise.resolve(getCamPhaRegion()));
    const districts = await log.run('Load Cẩm Phả administrative-unit collection',
      () => Promise.resolve(getCamPhaAdministrativeUnits()));

    // Full v5.3 mode cho snapshot nghiệp vụ: 1.800 mẫu, 100 cây RF, toàn bộ prior
    const rfResult = await runRfClassification(
      year,
      region,
      region.geometry(),
      {
        month,
        // Seed = year*100 + month (đồng bộ với satellite /classified)
        seed: year * 100 + month,
        groundTruthAssetId,
        groundTruthGeoJson,
        gtBufferM,
        minFieldTest,
        logger: log,
        liteMode: false,
        computeOob: true,
        computeTestMetrics: false,
      },
    );
    const { classified, quotas, oobPct } = rfResult;
    const classifiedForDownload = rfResult.classifiedNative || classified;
    const modelMeta = rfResult.modelMeta || null;
    const testAccuracyPct = null;
    const testKappa = null;

    // v5.3 thống kê ở 100m (1 pixel ≈ 1 ha)
    const AREA_SCALE_M = cfg.AREA_STATS_SCALE_M;
    const provinceSummary = await log.run(
      'EVALUATE province area stats (reduceRegion sum groupBy class)',
      () => computeProvinceAreaStats(classified, region, AREA_SCALE_M),
      { note: `scale=${AREA_SCALE_M}m tileScale=8 bestEffort` },
    );
    log.mark(
      'Province area',
      `totalHa=${provinceSummary.totalHa}, classes=${Object.keys(provinceSummary.byClass || {}).length}`,
    );

    const districtAreas = await log.run(
      'EVALUATE district area stats (reduceRegions sum groupBy class, coarse 200m)',
      () => computeDistrictAreaStats(classified, districts, AREA_SCALE_M),
      { note: `scale=${AREA_SCALE_M}m tileScale=8` },
    );
    log.mark('District area rows', `${districtAreas.length}`);

    // GEE tile URL — client render trực tiếp raster phân loại 13 lớp
    let geeMapId = null;
    let geeTileUrl = null;
    try {
      const mapInfo = await log.run(
        'Register GEE map (13-class viz → geeTileUrl)',
        () => getEeMapId(classified, CLASSIFIED_VIZ),
        { note: 'ee.data.getMapId — tile URL for /latest response' },
      );
      geeMapId = mapInfo.mapId || null;
      geeTileUrl = mapInfo.tileUrl || null;
    } catch (err) {
      console.warn(`[FOREST-CLS] getEeMapId failed (non-fatal): ${err.message}`);
    }

    // Seed district export skeletons trước khi materialize raster
    let districtGeoJson = getCamPhaAdministrativeUnitsGeoJson();
    if (districtGeoJson.length === 0) {
      const evaluatedUnits = await log.run(
        'Materialize fallback Cẩm Phả administrative units',
        () => eeEval(districts),
      );
      districtGeoJson = (evaluatedUnits?.features || []).map((feature, index) => ({
        ADM2_CODE: String(
          feature.properties?.ADM2_CODE
            ?? feature.properties?.ADM2_NAME
            ?? `campha-${index + 1}`,
        ),
        ADM2_NAME: feature.properties?.ADM2_NAME || `Cẩm Phả ${index + 1}`,
        NAME_EN: feature.properties?.NAME_EN || null,
        TYPE_2: feature.properties?.TYPE_2 || null,
        geometry: feature.geometry,
        epsg: 4326,
      }));
    }
    if (districtGeoJson.length === 0) {
      throw new Error('Không materialize được đơn vị hành chính Cẩm Phả cho district raster export.');
    }
    const areaByDistrict = new Map();
    for (const row of districtAreas) {
      const code = row.district_code ? String(row.district_code) : null;
      if (!code) {continue;}
      if (!areaByDistrict.has(code)) {
        areaByDistrict.set(code, {
          name: row.district_name,
          byClass: {},
        });
      }
      const bag = areaByDistrict.get(code);
      bag.byClass[row.class_id] = (bag.byClass[row.class_id] || 0)
        + Number(row.area_ha || 0);
    }
    const districtSkeletons = districtGeoJson.map((district) => ({
      district_code: district.ADM2_CODE,
      district_name: district.ADM2_NAME,
    }));
    const seededDistrictExports = await log.run(
      `Seed ${districtSkeletons.length} forest_district_exports (status=pending)`,
      () => repo.insertDistrictExports(
        snapshot.id,
        districtSkeletons,
        cfg.DOWNLOAD_SCALE_M,
      ),
    );

    // Piggyback modelMeta vào province_summary._modelMeta (không cần migration)
    const provinceSummaryWithMeta = modelMeta
      ? { ...provinceSummary, _modelMeta: modelMeta }
      : provinceSummary;

    const forestHa = cfg.FOREST_CLASS_IDS.reduce(
      (sum, classId) => sum + Number(provinceSummary.byClass?.[classId] || 0),
      0,
    );
    const districtExportSummary = {
      scaleM: cfg.DOWNLOAD_SCALE_M,
      total: districtGeoJson.length,
      completed: 0,
      failed: 0,
      skipped: 0,
      pending: districtGeoJson.length,
      totalHa: provinceSummary.totalHa,
      forestHa: Math.round(forestHa * 100) / 100,
      byClass: provinceSummary.byClass || {},
    };

    // Persist district area rows TRƯỚC khi công bố completed
    await log.run('Persist district area rows',
      () => repo.replaceDistrictAreas(snapshot.id, districtAreas));

    snapshot = await log.run('Update snapshot → status=completed', () =>
      repo.updateStatus(snapshot.id, 'completed', {
        province_summary: provinceSummaryWithMeta,
        oob_accuracy: oobPct !== null && oobPct !== undefined
          ? Math.round(oobPct * 100) / 100 : null,
        test_accuracy: testAccuracyPct !== null && testAccuracyPct !== undefined
          ? Math.round(testAccuracyPct * 100) / 100 : null,
        test_kappa: testKappa !== null && testKappa !== undefined
          ? Math.round(testKappa * 1000) / 1000 : null,
        sample_quotas: quotas,
        computed_at: new Date(),
        duration_ms: Date.now() - startMs,
        gee_map_id: geeMapId,
        gee_tile_url: geeTileUrl,
        gee_tile_generated_at: geeTileUrl ? new Date() : null,
        // gee_download_url NULL — FE lấy per-huyện qua district_exports
        gee_download_url: null,
        district_export_summary: districtExportSummary,
        download_scale_m: cfg.DOWNLOAD_SCALE_M,
        gt_zone_count: gtData.counts.zones,
        gt_point_count: gtData.counts.points,
        gt_window_days: gtWindowDays,
      }));

    // Async: enqueue district raster export worker
    districtRasterWorker.enqueue({
      kind: 'forest-classification',
      snapshotId: snapshot.id,
      label: `Forest district rasters ${year}-${String(month).padStart(2, '0')} snapshot=${snapshot.id}`,
      run: () => runForestDistrictRasterExport({
        snapshot,
        year,
        month,
        districtGeoJson,
        areaByDistrict,
        classifiedForDownload,
        seededDistrictExports,
        provinceSummary,
      }),
    }).catch((error) => {
      console.error(
        `[FOREST-CLS] district raster worker snapshot=${snapshot.id} failed: ${error.message}`,
      );
    });

    // Alert: so sánh với snapshot completed trước đó
    const prevSnapshot = await log.run(
      'Fetch previous completed snapshot (for area-change alert)',
      () => repo.getPreviousCompleted(year, month),
    );
    await log.run('Evaluate + dispatch top-3 changes alert',
      () => sendTop3ChangesAlert(snapshot, prevSnapshot, provinceSummary));

    log.summary();

    // Dedup notification (migration 040): chỉ gửi noti lần đầu completed
    _safe(async () => {
      const prior = await repo.countPriorCompletedAttempts(snapshot.id).catch(() => 0);
      if (prior > 0) {
        console.log(`[FOREST-CLS] notification SKIP — đã có ${prior} attempt completed trước (dedup theo year/month)`);
        return;
      }
      await _notifyForestClassificationCompleted(snapshot, provinceSummary);
    });

    return snapshot;
  } catch (err) {
    log.summary();
    console.error(`[FOREST-CLS] runAnalysis ${year}-${month} failed:`, err.message);
    await repo.updateStatus(snapshot.id, 'failed', { error_message: err.message });
    _safe(() => _notifyForestClassificationFailed(year, month, err.message));
    throw err;
  }
}

// ── Dedup wrapper (queue + child process branch) ─────────────────────────────

// Chặn hai request manual/user/cron cùng materialize graph GEE cho cùng kỳ
const activeRuns = new Map();

function runAnalysis(year, month, options = {}) {
  const key = `${year}-${String(month).padStart(2, '0')}`;
  const active = activeRuns.get(key);
  if (active) {
    console.warn(`[FOREST-CLS] runAnalysis DEDUPE period=${key} — reuse active run`);
    return active;
  }

  const run = geeQueue.enqueue({
    key: `analysis:forest-classification:${key}`,
    label: `Forest classification ${key}`,
    priority: 100,
    cooldownMs: ['manual', 'user'].includes(options.trigger)
      ? geeQueue.MANUAL_TASK_COOLDOWN_MS
      : 0,
    run: () => (
      process.env.GEE_ANALYSIS_CHILD === 'true'
        ? executeAnalysis(year, month, options)
        : geeAnalysisProcess.run({
          kind: 'forest-classification',
          payload: { year, month, options },
        })
    ),
  })
    .catch(async (error) => {
      if (process.env.GEE_ANALYSIS_CHILD !== 'true') {
        await repo.failActiveRunsForPeriod(year, month, error.message)
          .catch((dbError) => {
            console.error(
              `[FOREST-CLS] cannot close interrupted child run `
                + `period=${key}: ${dbError.message}`,
            );
          });
      }
      throw error;
    })
    .finally(() => activeRuns.delete(key));

  activeRuns.set(key, run);
  return run;
}

// ── Notification helpers ─────────────────────────────────────────────────────

const _safe = (fn) => {
  try {
    const r = fn();
    if (r?.catch) {r.catch((e) => console.warn('[FOREST-CLS] async helper err:', e.message));}
  } catch (e) {
    console.warn('[FOREST-CLS] sync helper err:', e.message);
  }
};

async function _notifyForestClassificationCompleted(snapshot, provinceSummary) {
  const notifSvc = require('./notification.service');
  const period = `${snapshot.year}-${String(snapshot.month).padStart(2, '0')}`;
  const byClass = provinceSummary?.byClass || {};
  const totalHa = Number(provinceSummary?.totalHa) || 0;
  const forestHa = cfg.FOREST_CLASS_IDS.reduce(
    (sum, classId) => sum + (Number(byClass[classId]) || 0),
    0,
  );

  const body = `Đã hoàn thành phân loại 11 lớp cho kỳ ${period}. `
    + `Tổng diện tích ${Math.round(totalHa).toLocaleString('vi')} ha; `
    + `diện tích rừng ${Math.round(forestHa).toLocaleString('vi')} ha. `
    + 'Dữ liệu bản đồ chi tiết theo huyện đang được hoàn thiện tự động.';
  const data = {
    snapshotId: snapshot.id,
    year: snapshot.year,
    month: snapshot.month,
    period,
    totalHa,
    forestHa,
  };

  for (const role of ['system_admin', 'so_tnmt', 'ubnd_tp']) {
    await notifSvc.broadcastToRole(role, {
      type: 'forest_classification_completed',
      title: `Phân loại lớp phủ rừng ${period} hoàn thành`,
      body,
      data,
      channel: 'system',
    }).catch((err) => {
      console.warn(`[FOREST-CLS] notify role=${role} failed:`, err.message);
    });
  }
}

async function _notifyForestClassificationFailed(year, month, errorMessage) {
  const notifSvc = require('./notification.service');
  const period = `${year}-${String(month).padStart(2, '0')}`;
  const publicError = toPublicProcessingError(errorMessage);
  await notifSvc.broadcastToRole('system_admin', {
    type: 'forest_classification_failed',
    title: `Phân loại lớp phủ rừng ${period} thất bại`,
    body: publicError,
    data: { year, month, period, error: publicError },
    channel: 'system',
  }).catch(() => {});
}

module.exports = {
  executeAnalysis,
  runAnalysis,
};
