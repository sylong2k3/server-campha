'use strict';

/**
 * M5 monitoring artifact catalog.
 *
 * Artifacts match the products produced by the single-period monitoring model
 * (new_code.js). Removed vs the annual FINAL model:
 *   - new_flood (requires two valid periods to compare; not computable here)
 *
 * flood_frequency is retained as a QA layer: in the single-period model it is
 * always 0 or 1, so it is technically redundant with flood_extent but is kept
 * to support calibration workflows that inspect the raw count image.
 */

const FINAL_ARTIFACTS = Object.freeze([
  // ── Primary flood product ─────────────────────────────────────────────
  {
    code: 'flood_extent',
    role: 'PRODUCT',
    style: 'flood_extent',
    label: { vi: 'Vùng ghi nhận ngập', en: 'Detected flood extent' },
  },
  // ── Impact products ────────────────────────────────────────────────────
  {
    code: 'pop_affected',
    role: 'PRODUCT',
    style: 'pop_affected',
    label: { vi: 'Dân số trong vùng ảnh hưởng', en: 'Affected population' },
  },
  {
    code: 'crop_affected',
    role: 'PRODUCT',
    style: 'crop_affected',
    label: { vi: 'Cây trồng trong vùng ảnh hưởng', en: 'Affected cropland' },
  },
  {
    code: 'built_affected',
    role: 'PRODUCT',
    style: 'built_affected',
    label: { vi: 'Khu xây dựng trong vùng ảnh hưởng', en: 'Affected built-up' },
  },
  // ── Risk / alert products ─────────────────────────────────────────────
  {
    code: 'pond_to_built',
    role: 'PRODUCT',
    style: 'pond_to_built',
    label: { vi: 'Ao/mặt nước chuyển thành khu xây dựng', en: 'Pond-to-built' },
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
    label: { vi: 'Cảnh báo tiêu thoát', en: 'Drainage encroachment alert' },
  },
  // ── QA ────────────────────────────────────────────────────────────────
  {
    code: 'frequent_flood',
    role: 'QA',
    style: 'frequent_flood',
    label: { vi: 'Phát hiện ngập (QA)', en: 'Flood detection flag (QA)' },
  },
  {
    code: 'flood_frequency',
    role: 'QA',
    style: 'flood_frequency',
    label: { vi: 'Tần số phát hiện ngập (QA)', en: 'Flood frequency count (QA)' },
  },
  {
    code: 'stratum',
    role: 'QA',
    style: 'stratum',
    label: { vi: 'Phân tầng khu vực (QA)', en: 'Monitoring stratum (QA)' },
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
