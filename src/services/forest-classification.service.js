'use strict';

/**
 * =============================================================================
 * FOREST CLASSIFICATION SERVICE — FACADE + READ APIs
 * =============================================================================
 * Public entry point. Chứa:
 *   - Public exports: runAnalysis, getLatest, getHistory, refresh,
 *     queryForPeriod, getSnapshotById
 *   - Read APIs (getLatest, getHistory, queryForPeriod, getSnapshotById)
 *   - buildSnapshotComparison (used by read APIs)
 *
 * Cấu trúc sau split (2026-08-05, file gốc 1142 LOC → 4 file):
 *   forest-classification.service.js     ← file này, facade + read APIs (~350 LOC)
 *   forest-classification.analysis.js    ← executeAnalysis + runAnalysis + notify (~470 LOC)
 *   forest-classification.districts.js   ← runForestDistrictRasterExport + auto-ingest (~280 LOC)
 *   forest-classification.stats.js       ← area stats + change alert + comparison helpers (~200 LOC)
 *
 * Public API KHÔNG đổi — controller / job / worker giữ nguyên import.
 * =============================================================================
 */

const repo = require('../repositories/forest-classification.repository');
const geeQueue = require('../queues/gee-task.queue');
const { BusinessLogicError } = require('../core/error.response');
const { StatusCodes } = require('../core/http-status-code');
const { parseInteger } = require('../../shared-utils/env');

const { runAnalysis } = require('./forest-classification.analysis');
const {
  buildAreaMetric,
  sumForestByClass,
  sumAllByClass,
  summarizeDistrict,
} = require('./forest-classification.stats');

const DEBUG = process.env.FC_DEBUG === 'true'
  || process.env.NODE_ENV === 'development';
const dbgTime = (tag, msg, t0) => {
  if (DEBUG) {console.debug(`[FOREST-CLS:DBG:${tag}] ${msg} (${Date.now() - t0}ms)`);}
};

const cfg = require('../configs/forest-classification');

// ── Snapshot comparison builder ──────────────────────────────────────────────

const buildSnapshotComparison = async (snapshot, districtAreas) => {
  if (!snapshot || !['completed', 'published'].includes(snapshot.status)) {return null;}

  const previousSnapshot = await repo.getPreviousCompleted(snapshot.year, snapshot.month);
  if (!previousSnapshot?.province_summary) {return null;}

  const currentSummary = snapshot.province_summary || {};
  const previousSummary = previousSnapshot.province_summary || {};
  const currentByClass = currentSummary.byClass || {};
  const previousByClass = previousSummary.byClass || {};
  const previousDistrictAreas = await repo.getDistrictAreas(previousSnapshot.id);

  const currentDistrictMap = new Map(
    (districtAreas || []).map((item) => [item.districtCode || item.districtName, item]),
  );
  const previousDistrictMap = new Map(
    previousDistrictAreas.map((item) => [item.districtCode || item.districtName, item]),
  );
  const districtKeys = new Set([...currentDistrictMap.keys(), ...previousDistrictMap.keys()]);

  const classes = cfg.CLASS_NAMES.map((className, classId) => ({
    classId,
    className,
    ...buildAreaMetric(currentByClass[classId], previousByClass[classId]),
  }));
  const districts = previousDistrictAreas.length > 0 ? [...districtKeys].map((key) => {
    const current = currentDistrictMap.get(key);
    const previous = previousDistrictMap.get(key);
    const currentStats = summarizeDistrict(current);
    const previousStats = summarizeDistrict(previous);
    return {
      districtCode: current?.districtCode || previous?.districtCode || null,
      districtName: current?.districtName || previous?.districtName || null,
      forest: buildAreaMetric(currentStats.forestHa, previousStats.forestHa),
    };
  }) : [];

  return {
    previousSnapshot: {
      id: previousSnapshot.id,
      year: previousSnapshot.year,
      month: previousSnapshot.month,
      computedAt: previousSnapshot.computed_at || null,
      publishedAt: previousSnapshot.published_at || null,
    },
    province: {
      total: buildAreaMetric(
        currentSummary.totalHa ?? sumAllByClass(currentByClass),
        previousSummary.totalHa ?? sumAllByClass(previousByClass),
      ),
      forest: buildAreaMetric(
        sumForestByClass(currentByClass),
        sumForestByClass(previousByClass),
      ),
      classes,
    },
    districts,
  };
};

// ── Public read APIs ─────────────────────────────────────────────────────────

const getLatest = async () => {
  const t0 = Date.now();
  let snapshot = await repo.getLatestCompleted();
  const newest = await repo.getLatest();
  const queueState = geeQueue.getState();

  const hasQueuedRun = Boolean(
    String(queueState.active?.key || '').startsWith('analysis:forest-classification:')
      || queueState.pending.some((entry) =>
        String(entry.key || '').startsWith('analysis:forest-classification:')),
  );

  const activeStatuses = new Set(['pending', 'computing', 'exporting']);
  const newestUpdatedAt = new Date(newest?.updated_at || newest?.created_at || 0).getTime();
  const activeMaxAgeMs = parseInteger(process.env.FC_ACTIVE_RUN_MAX_AGE_MS, 45 * 60 * 1000);

  const hasFreshActiveRun = newest
    && activeStatuses.has(newest.status)
    && Number.isFinite(newestUpdatedAt)
    && Date.now() - newestUpdatedAt < activeMaxAgeMs
    && (!snapshot || Number(newest.id) > Number(snapshot.id));

  if (hasFreshActiveRun) {
    dbgTime(
      'GET_LATEST',
      `active id=${newest.id} status=${newest.status} y/m=${newest.year}/${newest.month}`,
      t0,
    );
    return {
      snapshot: newest,
      processingSnapshot: newest,
      districtAreas: [],
      stale: true,
      computing: true,
      comparison: null,
    };
  }

  if (!snapshot) {
    if (newest) {
      dbgTime('GET_LATEST', `pending id=${newest.id} status=${newest.status} y/m=${newest.year}/${newest.month}`, t0);
      return {
        snapshot: newest,
        processingSnapshot: newest,
        districtAreas: [],
        stale: true,
        computing: activeStatuses.has(newest.status),
        comparison: null,
      };
    }
    if (hasQueuedRun) {
      dbgTime('GET_LATEST', 'queue active before snapshot row exists', t0);
      return {
        snapshot: null,
        processingSnapshot: null,
        districtAreas: [],
        stale: true,
        computing: true,
        comparison: null,
      };
    }
    dbgTime('GET_LATEST', 'no snapshot in DB → throw FC_NO_DATA', t0);
    throw new BusinessLogicError(
      'Chưa có dữ liệu phân loại rừng. Vui lòng thử lại sau.',
      ['FC_NO_DATA'],
      StatusCodes.SERVICE_UNAVAILABLE,
    );
  }

  if (snapshot.status === 'completed') {
    await repo.reconcileDistrictExportArtifacts(snapshot.id);
    const promoted = await repo.markPublishedIfDistrictsReady(snapshot.id);
    if (promoted) {snapshot = promoted;}
  }

  const districtAreas = await repo.getDistrictAreas(snapshot.id);
  const comparison = await buildSnapshotComparison(snapshot, districtAreas);
  dbgTime(
    'GET_LATEST',
    `snapshot=${snapshot.id} y/m=${snapshot.year}/${snapshot.month} status=${snapshot.status} `
      + `districts=${districtAreas.length} hasLayer=${Boolean(snapshot.geoserver_layer)} `
      + `hasDlUrl=${Boolean(snapshot.gee_download_url)}`,
    t0,
  );

  const isServingFallback = Boolean(newest && Number(newest.id) > Number(snapshot.id));
  return {
    snapshot,
    processingSnapshot: isServingFallback ? newest : snapshot,
    districtAreas,
    comparison,
    stale: isServingFallback,
    computing: false,
  };
};

const getHistory = async ({
  page = 1,
  limit = 24,
  hasGeoserverLayer,
  requireCompleteDistrictSet = false,
} = {}) => {
  const t0 = Date.now();
  const result = await repo.listCompleted({
    page,
    limit,
    hasGeoserverLayer,
    requireCompleteDistrictSet,
  });
  dbgTime(
    'GET_HISTORY',
    `page=${page} limit=${limit} hasGeoserverLayer=${hasGeoserverLayer ?? 'all'} `
      + `→ items=${result.items.length} total=${result.total}`,
    t0,
  );
  return result;
};

/**
 * Manual admin refresh — trigger analysis cho year/month cụ thể (hoặc hiện tại).
 */
const refresh = async ({ year, month, groundTruthAssetId, gtBufferM, minFieldTest } = {}) => {
  const now = new Date();
  const y = year || now.getUTCFullYear();
  const m = month || (now.getUTCMonth() + 1);
  console.log(`[FOREST-CLS] refresh (manual) triggered for period=${y}/${m}`);
  return runAnalysis(y, m, {
    trigger: 'manual',
    ...(groundTruthAssetId ? { groundTruthAssetId } : {}),
    ...(gtBufferM !== null && gtBufferM !== undefined ? { gtBufferM } : {}),
    ...(minFieldTest !== null && minFieldTest !== undefined ? { minFieldTest } : {}),
  });
};

// ── On-demand user query (cache-first) ───────────────────────────────────────

/**
 * User-facing on-demand query cho year/month cụ thể.
 * - Cache hit + completed → return luôn
 * - Đang computing → trả status, caller poll
 * - Không có / failed → trigger new analysis, trả pending snapshot
 */
const queryForPeriod = async (year, month, userId = null) => {
  const existing = await repo.getByYearMonth(year, month);

  if (existing) {
    if (['completed', 'published'].includes(existing.status)) {
      const districtAreas = await repo.getDistrictAreas(existing.id);
      const comparison = await buildSnapshotComparison(existing, districtAreas);
      return { snapshot: existing, districtAreas, comparison, cached: true, computing: false };
    }
    if (['pending', 'computing', 'exporting'].includes(existing.status)) {
      return {
        snapshot: existing,
        districtAreas: [],
        comparison: null,
        cached: false,
        computing: true,
      };
    }
    // failed / pending → fall through to re-trigger
  }

  // Trigger analysis in background — respond immediately với computing=true
  runAnalysis(year, month, { trigger: 'user', requestedBy: userId })
    .catch((err) => console.error(`[FOREST] user query y=${year} m=${month}:`, err.message));

  // Analysis chạy trong child process → chờ ngắn để lấy ID attempt mới
  let pending = null;
  const previousId = existing?.id || null;
  for (let attempt = 0; attempt < 20; attempt++) {
    const candidate = await repo.getByYearMonth(year, month);
    if (
      candidate
      && candidate.id !== previousId
      && ['pending', 'computing'].includes(candidate.status)
    ) {
      pending = candidate;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (!pending) {pending = { id: null, year, month, status: 'computing' };}

  return {
    snapshot: pending,
    districtAreas: [],
    comparison: null,
    cached: false,
    computing: true,
  };
};

/**
 * Snapshot theo ID với district areas + comparison. Dùng cho polling user-triggered.
 */
const getSnapshotById = async (id) => {
  const snapshot = await repo.getById(id);
  if (!snapshot) {return null;}
  const districtAreas = ['completed', 'published'].includes(snapshot.status)
    ? await repo.getDistrictAreas(snapshot.id)
    : [];
  const comparison = await buildSnapshotComparison(snapshot, districtAreas);
  return { snapshot, districtAreas, comparison };
};

// ── Public API ────────────────────────────────────────────────────────────────

module.exports = {
  runAnalysis,
  getLatest,
  getHistory,
  refresh,
  queryForPeriod,
  getSnapshotById,
};
