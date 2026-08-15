'use strict';

/**
 * M6 Forecast — Kịch bản Lượng mưa + Thuỷ triều (Trực tiếp - Không dùng GEE).
 *
 * Mô hình tính toán:
 *   h_rain_m  = rainfallCoefficient × (rainfall_24h / 100) ^ 0.6  (nếu có mưa)
 *   h_eff_m   = max(0, h_rain_m + tideLevelM)                     (triều là tùy chọn)
 *
 * Khi người dùng chọn/nhập mực thuỷ triều hoặc lượng mưa, hệ thống tính mực nước
 * hiệu dụng h_eff_m và trực tiếp truy vấn/khớp lớp phủ tương ứng trong hệ thống
 * (GeoServer / PostgreSQL layer registry) để trả về ngay tức thì mà không cần
 * thông qua hàng đợi GEE.
 *
 * @module services/flood/forecast/index
 */

const defaultsAndConfig = require('../config/defaults');
const versions = require('../config/versions');
const tideHelpers = require('./tide');
const resultHelpers = require('./result');
const layerRepo = require('../../../repositories/layer.repository');
const db = require('../../../configs/database');

/**
 * Tính toán kịch bản dự báo ngập tức thì và trả về lớp phủ tương ứng từ cơ sở dữ liệu.
 *
 * @param {object} runConfig
 * @param {object} [runConfig.rainfall]      — { amount24h } lượng mưa 24h (mm), tùy chọn
 * @param {number} [runConfig.tideLevelM]   — mực thuỷ triều (m), tùy chọn
 * @param {number} [runConfig.rainfallCoefficient=2.0]
 * @returns {Promise<object>} — Kết quả kịch bản ngập lụt tức thì chứa thông tin lớp phủ
 */
async function getForecastScenario(runConfig = {}) {
    const config = {
        ...defaultsAndConfig.FORECAST_DEFAULTS,
        ...runConfig,
    };

    // 1. Tính toán h_eff từ mưa + triều (không dùng GEE, tính trực tiếp JS)
    const { rainLevelM, tideLevelM, effectiveLevelM } = tideHelpers.computeEffectiveLevel(config);
    const rainfall24hMm = config?.rainfall?.amount24h ?? 0;

    // 2. Truy vấn các lớp phủ ngập lụt hiện có trong cơ sở dữ liệu (gis.layers / flood_artifacts)
    let floodLayers = [];
    try {
        const queryRes = await db.query(
            `SELECT id, code, name_vi, geoserver_layer, style_name, category, publish_status, is_public
               FROM gis.layers
              WHERE deleted_at IS NULL
                AND (category IN ('flood', 'lop-phu-ngap') OR code LIKE 'fl_%' OR code LIKE '%forecast%')
              ORDER BY created_at DESC`,
        );
        floodLayers = queryRes.rows;
    } catch {
        /* fallback nếu DB tạm thời chưa query được */
    }

    // 3. Khớp lớp phủ phù hợp nhất dựa trên h_eff
    let matchedLayer = floodLayers.find((l) => l.code.includes('forecast_flood_mask')) ||
        floodLayers.find((l) => l.category === 'flood' && l.geoserver_layer) ||
        null;

    const catalog = resultHelpers.selectM6Artifacts();
    const metadata = resultHelpers.buildM6ResultMetadata({
        rainfall24hMm,
        rainfall72hMm: config.rainfall?.amount72h ?? null,
        rainfall7dMm: config.rainfall?.amount7d ?? null,
        tideLevelM,
        rainLevelM,
        effectiveLevelM,
        rainfallCoefficient: config.rainfallCoefficient,
        maximumSlope: config.maximumSlope,
        maximumHAND: config.maximumHAND,
        warnings: effectiveLevelM <= 0 ? ['EFFECTIVE_LEVEL_NON_POSITIVE'] : [],
    });

    metadata.pipelineVersion = versions.pipelineVersionFor('forecast');
    metadata.configVersion = versions.CONFIG_VERSION;

    return {
        success: true,
        scenarioName: `Kịch bản dự báo ngập lụt (${effectiveLevelM.toFixed(2)} m)`,
        effectiveLevelM,
        rainLevelM,
        tideLevelM,
        rainfall24hMm,
        matchedLayer,
        layers: floodLayers.slice(0, 5),
        catalog,
        metadata,
    };
}

module.exports = {
    getForecastScenario,
    computeEffectiveLevel: tideHelpers.computeEffectiveLevel,
};
