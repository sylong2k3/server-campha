'use strict';

/**
 * M6 forecast artifact catalog + result metadata builder.
 *
 * Artifact codes:
 *   forecast_flood_mask   — nhị phân: 1 = dự báo ngập, 0 = không ngập
 *   forecast_flood_depth  — độ sâu ngập dự báo (m): max(0, h_eff - HAND)
 *   forecast_flood_class  — 3 mức: 1 thấp / 2 trung bình / 3 cao
 *
 * §16 — label PHẢI là "Dự báo ngập (kịch bản)" / "Flood Forecast (Scenario)",
 * KHÔNG gọi là "Ngập quan sát" hay "Xác suất".
 *
 * @rule architecture doc §16 (no-probability label), §19 (product/calibration split)
 */

const M6_ARTIFACTS = Object.freeze([
    {
        code: 'forecast_flood_mask',
        role: 'PRODUCT',
        label: {
            vi: 'Lớp phủ dự báo ngập (nhị phân)',
            en: 'Forecast flood mask (binary)',
        },
        description:
            'Binary mask: pixel = 1 where HAND ≤ effective inundation level (rain + tide). ' +
            'This is a scenario, not an observation.',
        style: 'forecast_flood_mask',
    },
    {
        code: 'forecast_flood_depth',
        role: 'PRODUCT',
        label: {
            vi: 'Độ sâu ngập dự báo (m)',
            en: 'Forecast flood depth (m)',
        },
        description:
            'Estimated inundation depth = h_eff − HAND (metres), clipped to ≥ 0. ' +
            'Zero outside the forecast mask.',
        style: 'forecast_flood_depth',
    },
    {
        code: 'forecast_flood_class',
        role: 'PRODUCT',
        label: {
            vi: 'Dự báo ngập — phân lớp (1/2/3)',
            en: 'Flood forecast — classified (1/2/3)',
        },
        description:
            '3-class inundation forecast: 1 = thấp (low risk) / 2 = trung bình (medium) / 3 = cao (high). ' +
            'Derived from the HAND margin above the effective level.',
        style: 'forecast_flood_class',
    },
]);

const CODE_TO_ARTIFACT = Object.freeze(Object.fromEntries(M6_ARTIFACTS.map((a) => [a.code, a])));

function selectM6Artifacts({ runMode = 'product' } = {}) {
    return M6_ARTIFACTS.map((a) => ({
        ...a,
        role: runMode === 'calibration' && a.role === 'QA' ? 'CALIBRATION' : a.role,
    }));
}

/**
 * Builds the metadata JSON stamped on the flood_artifacts and flood_analysis_runs rows.
 *
 * @param {object} args
 * @param {number}        args.rainfall24hMm         — lượng mưa 24 h nhập vào (mm)
 * @param {number|null}   args.rainfall72hMm         — lượng mưa 72 h (mm, nếu có)
 * @param {number|null}   args.rainfall7dMm          — lượng mưa 7 ngày (mm, nếu có)
 * @param {number}        args.tideLevelM             — mực thuỷ triều nhập vào (m)
 * @param {number}        args.rainLevelM             — h_rain tính được (m)
 * @param {number}        args.effectiveLevelM        — h_eff = h_rain + h_tide (m)
 * @param {number}        args.rainfallCoefficient    — hệ số mô hình
 * @param {number}        args.maximumSlope           — ngưỡng dốc tối đa (deg)
 * @param {number}        args.maximumHAND            — giới hạn HAND (m)
 * @param {number|null}   args.forecastAreaHa         — diện tích dự báo ngập (ha)
 * @param {number|null}   args.meanDepthM             — độ sâu trung bình (m)
 * @param {number|null}   args.maxDepthM              — độ sâu lớn nhất (m)
 * @param {string[]}      args.warnings               — cảnh báo phi-fatal
 */
function buildM6ResultMetadata({
    rainfall24hMm = null,
    rainfall72hMm = null,
    rainfall7dMm = null,
    tideLevelM = null,
    rainLevelM = null,
    effectiveLevelM = null,
    rainfallCoefficient = null,
    maximumSlope = null,
    maximumHAND = null,
    forecastAreaHa = null,
    meanDepthM = null,
    maxDepthM = null,
    warnings = [],
} = {}) {
    return {
        // ── Inputs ──────────────────────────────────────────────────────────
        rainfall24hMm: Number.isFinite(rainfall24hMm) ? rainfall24hMm : null,
        rainfall72hMm: Number.isFinite(rainfall72hMm) ? rainfall72hMm : null,
        rainfall7dMm: Number.isFinite(rainfall7dMm) ? rainfall7dMm : null,
        tideLevelM: Number.isFinite(tideLevelM) ? tideLevelM : null,
        // ── Computed ─────────────────────────────────────────────────────────
        rainLevelM: Number.isFinite(rainLevelM) ? rainLevelM : null,
        effectiveLevelM: Number.isFinite(effectiveLevelM) ? effectiveLevelM : null,
        rainfallCoefficient: Number.isFinite(rainfallCoefficient) ? rainfallCoefficient : null,
        // ── Thresholds ───────────────────────────────────────────────────────
        maximumSlope: Number.isFinite(maximumSlope) ? maximumSlope : null,
        maximumHAND: Number.isFinite(maximumHAND) ? maximumHAND : null,
        // ── Metrics ──────────────────────────────────────────────────────────
        forecastAreaHa: Number.isFinite(forecastAreaHa) ? forecastAreaHa : null,
        meanDepthM: Number.isFinite(meanDepthM) ? meanDepthM : null,
        maxDepthM: Number.isFinite(maxDepthM) ? maxDepthM : null,
        // §16 — NEVER calibrated probability
        PROBABILITY_CALIBRATED: false,
        warnings: Array.isArray(warnings) ? warnings : [],
    };
}

module.exports = {
    M6_ARTIFACTS,
    CODE_TO_ARTIFACT,
    selectM6Artifacts,
    buildM6ResultMetadata,
};
