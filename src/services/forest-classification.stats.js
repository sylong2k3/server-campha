'use strict';

/**
 * =============================================================================
 * FOREST CLASSIFICATION — AREA STATS + CHANGE ALERT
 * =============================================================================
 * Trách nhiệm:
 *   - computeProvinceAreaStats: reduceRegion.sum theo class
 *   - computeDistrictAreaStats: reduceRegions cho all districts
 *   - sendTop3ChangesAlert: gửi noti alert khi biến động class > threshold
 *
 * Không side effect ngoài GEE eval + notification. Được analysis.js gọi ngay
 * sau khi RF classification hoàn thành.
 * =============================================================================
 */

const cfg = require('../configs/forest-classification');
const { ee } = require('../configs/gge');
const { eeEval } = require('../utils/gee-satellite.util');

const DEBUG = process.env.FC_DEBUG === 'true'
  || process.env.NODE_ENV === 'development';
const dbg = (tag, msg) => {
  if (DEBUG) {console.debug(`[FOREST-CLS:DBG:${tag}] ${msg}`);}
};

// ── Province-level area stats ────────────────────────────────────────────────

async function computeProvinceAreaStats(classified, region, scaleM) {
  const areaImg = ee.Image.pixelArea().divide(10000).addBands(classified.rename('class'));
  const result = await eeEval(
    areaImg.reduceRegion({
      reducer: ee.Reducer.sum().group({ groupField: 1, groupName: 'class' }),
      geometry: region.geometry(),
      scale: scaleM || cfg.AREA_STATS_SCALE_M,
      bestEffort: true,
      maxPixels: 1e13,
      tileScale: 8,
    }),
  );
  const groups = result.groups || [];
  const byClass = {};
  let totalHa = 0;
  for (const g of groups) {
    const ha = Math.round((g.sum || 0) * 100) / 100;
    byClass[g.class] = ha;
    totalHa += ha;
  }
  return { byClass, totalHa: Math.round(totalHa * 100) / 100 };
}

// ── District-level area stats ────────────────────────────────────────────────

async function computeDistrictAreaStats(classified, districts, scaleM) {
  const areaImg = ee.Image.pixelArea().divide(10000).addBands(classified.rename('class'));
  const reduced = areaImg.reduceRegions({
    collection: districts,
    reducer: ee.Reducer.sum().group({ groupField: 1, groupName: 'class' }),
    scale: scaleM || cfg.AREA_STATS_SCALE_M,
    tileScale: 8,
  });

  const fcResult = await eeEval(reduced);
  const distStats = [];

  for (const feat of (fcResult.features || [])) {
    const p = feat.properties || {};
    const groups = p.groups || [];
    for (const g of groups) {
      const classId = g.class;
      const ha = Math.round((g.sum || 0) * 100) / 100;
      if (ha <= 0) {continue;}
      distStats.push({
        district_code: p.ADM2_CODE || null,
        district_name: p.ADM2_NAME || p.ADM1_NAME || null,
        class_id: classId,
        class_name: cfg.CLASS_NAMES[classId] || `Class ${classId}`,
        area_ha: ha,
      });
    }
  }
  return distStats;
}

// ── Alert: top-3 changes vs previous month ───────────────────────────────────

/**
 * So sánh từng class giữa snapshot hiện tại vs prev, sort theo |change%| desc,
 * gửi notification liệt kê 3 class biến động mạnh nhất. Chỉ trigger nếu class
 * top-1 vượt ALERT_FOREST_CHANGE_PCT (default 2%).
 */
async function sendTop3ChangesAlert(snapshot, prevSnapshot, provinceSummary) {
  try {
    const prevSummary = prevSnapshot?.province_summary;
    if (!prevSummary) {
      dbg('ALERT', 'skip — no previous snapshot for comparison');
      return;
    }
    const notifSvc = require('./notification.service');

    // Tính change cho MỌI class (kể cả class 0 "Đất khác"). Class có prev=0
    // và curr>0 → % = Infinity, treat as "mới xuất hiện" với +100%.
    const changes = [];
    for (let i = 0; i < cfg.CLASS_NAMES.length; i++) {
      const prevHa = Number(prevSummary.byClass?.[i]) || 0;
      const currHa = Number(provinceSummary.byClass?.[i]) || 0;
      if (prevHa === 0 && currHa === 0) {continue;}
      const pct = prevHa === 0
        ? 100
        : ((currHa - prevHa) / prevHa) * 100;
      changes.push({
        classId: i,
        name: cfg.CLASS_NAMES[i],
        prevHa,
        currHa,
        deltaHa: currHa - prevHa,
        pct,
        absPct: Math.abs(pct),
      });
    }

    changes.sort((a, b) => b.absPct - a.absPct);
    const top3 = changes.slice(0, 3);
    if (top3.length === 0) {return;}

    const threshold = cfg.ALERT_FOREST_CHANGE_PCT;
    if (top3[0].absPct < threshold) {
      dbg('ALERT', `skip — top-1 change ${top3[0].absPct.toFixed(2)}% < threshold ${threshold}%`);
      return;
    }

    const period = `${snapshot.year}/${String(snapshot.month).padStart(2, '0')}`;
    const prevPeriod = `${prevSnapshot.year}/${String(prevSnapshot.month).padStart(2, '0')}`;
    const lines = top3.map((c, idx) => {
      const sign = c.pct >= 0 ? '+' : '';
      return `  ${idx + 1}. ${c.name}: ${sign}${c.pct.toFixed(1)}% `
        + `(${c.prevHa.toLocaleString('vi')} → ${c.currHa.toLocaleString('vi')} ha)`;
    });
    const title = `Cảnh báo biến động rừng ${period}`;
    const body = `So sánh với ${prevPeriod}. Top 3 lớp biến động mạnh nhất:\n${lines.join('\n')}`;

    for (const role of ['system_admin', 'so_tnmt', 'ubnd_tp']) {
      await notifSvc.broadcastToRole(role, {
        type: 'forest_change_alert',
        title,
        body,
        data: { snapshotId: snapshot.id, period, previousPeriod: prevPeriod, top3 },
        channel: 'alert',
      });
    }
    console.log(
      `[FOREST] top-3 alert dispatched period=${period} vs ${prevPeriod} ` +
        `top1=${top3[0].name} ${top3[0].pct.toFixed(1)}%`,
    );
  } catch (err) {
    console.warn('[FOREST] Alert notification failed:', err.message);
  }
}

// ── Comparison helpers (used by public read APIs in service.js) ──────────────

const roundComparisonValue = (value) => Math.round((Number(value) || 0) * 100) / 100;

const buildAreaMetric = (currentHa, previousHa) => {
  const current = roundComparisonValue(currentHa);
  const previous = roundComparisonValue(previousHa);
  const deltaHa = roundComparisonValue(current - previous);
  const changePct = previous > 0
    ? roundComparisonValue((deltaHa / previous) * 100)
    : (current === 0 ? 0 : null);
  return { currentHa: current, previousHa: previous, deltaHa, changePct };
};

const sumForestByClass = (byClass = {}) => cfg.FOREST_CLASS_IDS.reduce(
  (sum, classId) => sum + (Number(byClass[classId]) || 0),
  0,
);

const sumAllByClass = (byClass = {}) => Object.values(byClass).reduce(
  (sum, areaHa) => sum + (Number(areaHa) || 0),
  0,
);

const summarizeDistrict = (district) => {
  const byClass = {};
  let totalHa = 0;
  for (const item of (district?.classes || [])) {
    const classId = Number(item.classId);
    const areaHa = Number(item.areaHa) || 0;
    byClass[classId] = areaHa;
    totalHa += areaHa;
  }
  return { byClass, totalHa, forestHa: sumForestByClass(byClass) };
};

module.exports = {
  computeProvinceAreaStats,
  computeDistrictAreaStats,
  sendTop3ChangesAlert,
  roundComparisonValue,
  buildAreaMetric,
  sumForestByClass,
  sumAllByClass,
  summarizeDistrict,
};
