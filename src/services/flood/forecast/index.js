'use strict';

/**
 * M6 Forecast — Trả về lớp phủ ngập lụt có sẵn (Demo - Không tính toán).
 *
 * Chỉ lấy lớp phủ ngập lụt hiện có trong hệ thống (gis.layers) để làm demo
 * hiển thị tức thì trên bản đồ.
 *
 * @module services/flood/forecast/index
 */

const db = require('../../../configs/database');

/**
 * Trả về lớp phủ dự báo ngập lụt có sẵn cho demo.
 *
 * @param {object} runConfig
 * @returns {Promise<object>} — Lớp phủ ngập lụt có sẵn từ cơ sở dữ liệu
 */
async function getForecastScenario(runConfig = {}) {
    const rainfall24hMm = runConfig?.rainfall?.amount24h ?? runConfig?.amount24h ?? null;
    const tideLevelM = runConfig?.tideLevelM ?? null;

    let floodLayers = [];
    try {
        const queryRes = await db.query(
            `SELECT id, code, name_vi, geoserver_layer, style_name, category, publish_status, is_public
               FROM gis.layers
              WHERE deleted_at IS NULL
                AND (category IN ('flood', 'lop-phu-ngap') OR code LIKE '%flood%' OR code LIKE '%hand%')
              ORDER BY id DESC`,
        );
        floodLayers = queryRes.rows;
    } catch {
        /* fallback nếu DB gián đoạn */
    }

    const matchedLayer = floodLayers[0] || {
        id: '50',
        code: 'fl_forecast_forecast_flood_mask_r28',
        name_vi: 'Lớp phủ dự báo ngập (nhị phân)',
        geoserver_layer: 'campha:fl_forecast_forecast_flood_mask_r28',
        style_name: 'forecast_flood_mask',
        category: 'flood',
        publish_status: 'published',
        is_public: true,
    };

    return {
        success: true,
        scenarioName: 'Kịch bản dự báo ngập lụt',
        rainfall24hMm,
        tideLevelM,
        matchedLayer,
        layers: floodLayers,
    };
}

module.exports = {
    getForecastScenario,
};
