'use strict';

/**
 * FINAL M5 artifact catalog.
 *
 * Expanded from V1 to include:
 *   - flood_extent     (primary flood product)
 *   - flood_frequency  (count per season, 0–4)
 *   - frequent_flood
 *   - new_flood
 *   - pop_affected     (WorldPop within flood extent)
 *   - crop_affected    (WorldCover cropland within flood extent)
 *   - built_affected   (WorldCover built-up within flood extent)
 *   - pond_to_built
 *   - drainage_sensitive
 *   - encroachment_alert
 *   - stratum          (QA: stratification layer)
 *
 * Removed vs V1: trend_tidal_candidate (no tidal splitting in FINAL).
 */

const FINAL_ARTIFACTS = Object.freeze([
  // ── Primary products ──────────────────────────────────────────────────
  {
    code: 'flood_extent',
    role: 'PRODUCT',
    style: 'flood_extent',
    label: { vi: 'Vùng ngập', en: 'Flood extent' },
  },
  {
    code: 'flood_frequency',
    role: 'PRODUCT',
    style: 'flood_frequency',
    label: { vi: 'Tần suất ngập (số mùa)', en: 'Flood frequency (seasons)' },
  },
  {
    code: 'frequent_flood',
    role: 'PRODUCT',
    style: 'frequent_flood',
    label: { vi: 'Vùng ngập tái diễn', en: 'Frequent flood zone' },
  },
  {
    code: 'new_flood',
    role: 'PRODUCT',
    style: 'new_flood',
    label: { vi: 'Vùng ngập mới', en: 'New flood' },
  },
  // ── Impact products ────────────────────────────────────────────────────
  {
    code: 'pop_affected',
    role: 'PRODUCT',
    style: 'pop_affected',
    label: { vi: 'Dân số bị ảnh hưởng', en: 'Affected population' },
  },
  {
    code: 'crop_affected',
    role: 'PRODUCT',
    style: 'crop_affected',
    label: { vi: 'Cây trồng bị ảnh hưởng', en: 'Affected cropland' },
  },
  {
    code: 'built_affected',
    role: 'PRODUCT',
    style: 'built_affected',
    label: { vi: 'Đất xây dựng bị ảnh hưởng', en: 'Affected built-up' },
  },
  // ── Risk / alert products ─────────────────────────────────────────────
  {
    code: 'pond_to_built',
    role: 'PRODUCT',
    style: 'pond_to_built',
    label: { vi: 'Ao/mặt nước chuyển sang xây dựng', en: 'Pond-to-built' },
  },
  {
    code: 'drainage_sensitive',
    role: 'PRODUCT',
    style: 'drainage_sensitive',
    label: { vi: 'Vùng nhạy cảm tiêu thoát', en: 'Drainage-sensitive zone' },
  },
  {
    code: 'encroachment_alert',
    role: 'PRODUCT',
    style: 'encroachment_alert',
    label: { vi: 'Cảnh báo lấn chiếm tiêu thoát', en: 'Drainage encroachment alert' },
  },
  // ── QA ────────────────────────────────────────────────────────────────
  {
    code: 'stratum',
    role: 'QA',
    style: 'stratum',
    label: { vi: 'Phân tầng giám sát (QA)', en: 'Monitoring stratum (QA)' },
  },
]);

/**
 * Return the artifact list for a given run mode.
 * In calibration mode, QA artifacts get role='CALIBRATION'.
 */
function selectFinalArtifacts({ runMode = 'product' } = {}) {
  return FINAL_ARTIFACTS.map((a) => ({
    ...a,
    description: a.label.en,
    role: runMode === 'calibration' && a.role === 'QA' ? 'CALIBRATION' : a.role,
  }));
}

module.exports = { FINAL_ARTIFACTS, selectFinalArtifacts };
