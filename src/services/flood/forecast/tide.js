'use strict';

/**
 * Rainfall → equivalent inundation level + tidal contribution helpers (M6).
 *
 * Background:
 *   Cẩm Phả nằm trong vùng vịnh Bái Tử Long — chế độ triều nhật triều không
 *   đều, biên độ thực tế ~0.0 – 3.5 m (đỉnh triều MHHW ≈ 3.2 m so với CDL).
 *   Công thức quy đổi mưa → mực ngập tương đương (h_rain) là xấp xỉ kinh
 *   nghiệm dựa trên đặc điểm lưu vực: độ dốc nhỏ, thoát nước hạn chế.
 *
 * Mô hình:
 *   h_rain_m  = rainfallCoefficient × (rainfall_24h_mm / 100) ^ RAIN_EXPONENT
 *   h_eff_m   = h_rain_m + tideLevelM
 *   Vùng ngập = pixel: HAND(m) ≤ h_eff_m  AND slope ≤ maximumSlope
 *
 * Tham số mặc định và RAIN_EXPONENT = 0.6 đến từ phân tích hồi quy đơn giản
 * trên số liệu lịch sử Quảng Ninh 2015–2023 (xem docs/M6_calibration.md §3).
 * Khi có số liệu thực đo tốt hơn: chỉnh rainfallCoefficient và RAIN_EXPONENT
 * trong FORECAST_DEFAULTS (config/defaults.js).
 *
 * KHÔNG label kết quả là "xác suất" — §16 architecture doc.
 *
 * @module services/flood/forecast/tide
 * @source  docs/M6_calibration.md §2–3
 * @rule    architecture doc §15 (change lock), §16 (no-probability label)
 */

/**
 * Luỹ thừa xấp xỉ phi tuyến — phản ánh sự bão hoà đất khi mưa lớn.
 * Giá trị 0.6 giữ nguyên trừ khi có bằng chứng thực đo khác (§15).
 */
const RAIN_EXPONENT = 0.6;

/**
 * Giới hạn an toàn để tránh mực ngập tính toán phi thực tế.
 * Ứng với mưa 2000 mm/24 h × coefficient 2.0 → ~8.6 m — đủ lớn cho mọi
 * kịch bản thực tế ở Cẩm Phả.
 */
const MAX_RAIN_LEVEL_M = 20;

/**
 * Quy đổi lượng mưa 24 h (mm) sang mực ngập tương đương (m).
 *
 * @param {number} rainfall24hMm      — tổng mưa 24 giờ (mm), ≥ 0
 * @param {object} [options]
 * @param {number} [options.rainfallCoefficient=2.0] — hệ số mô hình (m)
 * @returns {number} h_rain_m — mực ngập tương đương (m), ≥ 0
 */
function rainfallToEquivalentLevelM(rainfall24hMm, { rainfallCoefficient = 2.0 } = {}) {
    if (!Number.isFinite(rainfall24hMm) || rainfall24hMm < 0) {
        throw new Error('forecast.tide.rainfallToEquivalentLevelM: rainfall24hMm must be a non-negative number');
    }
    if (!Number.isFinite(rainfallCoefficient) || rainfallCoefficient <= 0) {
        throw new Error('forecast.tide.rainfallToEquivalentLevelM: rainfallCoefficient must be a positive number');
    }
    if (rainfall24hMm === 0) {
        return 0;
    }
    const raw = rainfallCoefficient * Math.pow(rainfall24hMm / 100, RAIN_EXPONENT);
    return Math.min(raw, MAX_RAIN_LEVEL_M);
}

/**
 * Tổng hợp mực ngập hiệu dụng từ hai thành phần: mưa + thuỷ triều.
 *
 * Kết quả là ngưỡng HAND (m) được dùng để xác định vùng ngập dự báo:
 *   pixel ngập khi HAND(m) ≤ effectiveLevelM(...)
 *
 * @param {number} rainLevelM   — mực ngập từ mưa (m), từ rainfallToEquivalentLevelM
 * @param {number} tideLevelM   — mực thuỷ triều (m, so với CDL/MSL)
 * @returns {number} h_eff_m — mực ngập hiệu dụng (m), ≥ 0
 */
function effectiveLevel(rainLevelM, tideLevelM) {
    if (!Number.isFinite(rainLevelM)) {
        throw new Error('forecast.tide.effectiveLevel: rainLevelM must be a finite number');
    }
    if (!Number.isFinite(tideLevelM)) {
        throw new Error('forecast.tide.effectiveLevel: tideLevelM must be a finite number');
    }
    // Mực triều âm (nước rút) vẫn được cho phép nhưng kết quả không âm.
    return Math.max(0, rainLevelM + tideLevelM);
}

/**
 * Tính mực ngập hiệu dụng từ config M6 và trả về các thành phần rời rạc
 * để stamp vào metadata.
 *
 * @param {object} config
 * @param {object} config.rainfall              — { amount24h: number }
 * @param {number} config.tideLevelM            — mực thuỷ triều (m)
 * @param {number} [config.rainfallCoefficient] — hệ số mô hình (m)
 * @returns {{ rainLevelM: number, tideLevelM: number, effectiveLevelM: number }}
 */
function computeEffectiveLevel(config) {
    const rainfall24h = config?.rainfall?.amount24h ?? 0;
    const tideLevelM = config?.tideLevelM ?? 0;
    const rainfallCoefficient = config?.rainfallCoefficient ?? 2.0;

    const rainLevelM = rainfallToEquivalentLevelM(rainfall24h, { rainfallCoefficient });
    const effectiveLevelM = effectiveLevel(rainLevelM, tideLevelM);
    return { rainLevelM, tideLevelM, effectiveLevelM };
}

module.exports = {
    RAIN_EXPONENT,
    MAX_RAIN_LEVEL_M,
    rainfallToEquivalentLevelM,
    effectiveLevel,
    computeEffectiveLevel,
};
