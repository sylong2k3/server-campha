'use strict';

/**
 * Per-artifact palette + display-band descriptors.
 *
 * Keyed by `artifact_code` (matches the `gis.flood_artifacts.artifact_code`
 * column and the `code` field in each module's result.js catalog).
 *
 * Palettes are RGB hex arrays (short 3-hex or 6-hex accepted by both Mapbox
 * GL and GeoServer SLD). The client renders the visualisation itself when
 * showing GEE preview tiles, and GeoServer wraps the same palette in a
 * `styles.js` SLD when publishing.
 */

const M1_LAYERS = Object.freeze({
    main_flood_non_tidal: {
        palette: ['1E4F8C'],
        min: 1,
        max: 1,
        label: {
            vi: 'Ngập lụt',
            en: 'Confirmed flood',
        },
    },
    open_water: {
        palette: ['0E2F5C'],
        min: 1,
        max: 1,
        label: { vi: 'Mặt nước mở', en: 'Open water' },
    },
    shallow_flood: {
        palette: ['6BAED6'],
        min: 1,
        max: 1,
        label: { vi: 'Ngập nông (QA)', en: 'Shallow flood (QA)' },
    },
    tidal_candidate: {
        palette: ['9E9AC8'],
        min: 1,
        max: 1,
        label: { vi: 'Nghi vùng triều (QA)', en: 'Tidal candidate (QA)' },
    },
    mining_candidate: {
        palette: ['B45F06'],
        min: 1,
        max: 1,
        label: { vi: 'Nghi khai trường mỏ (QA)', en: 'Mining candidate (QA)' },
    },
    urban_double_bounce: {
        palette: ['E7298A'],
        min: 1,
        max: 1,
        label: { vi: 'Nghi phản xạ đôi đô thị (QA)', en: 'Urban double-bounce (QA)' },
    },
});

const M2_LAYERS = Object.freeze({
    hand_scenario: {
        palette: ['08519C'],
        min: 1,
        max: 1,
        label: { vi: 'Kịch bản HAND', en: 'HAND scenario' },
    },
    hand_depth: {
        // Blue gradient — light shallow → deep dark.
        palette: ['deebf7', '9ecae1', '4292c6', '08519c', '08306b'],
        min: 0,
        max: 5,
        label: {
            vi: 'Độ sâu ngập kịch bản HAND (m)',
            en: 'HAND scenario depth (m)',
        },
    },
});

const M3_LAYERS = Object.freeze({
    // Continuous 0..1 risk score — sequential yellow → red palette.
    rain_risk_score: {
        palette: ['fee5d9', 'fcae91', 'fb6a4a', 'de2d26', 'a50f15'],
        min: 0,
        max: 1,
        label: {
            vi: 'Chỉ số rủi ro (mưa)',
            en: 'Rain Risk Index (0..1)',
        },
    },
    rain_risk_class: {
        // 1 = low (yellow), 2 = medium (orange), 3 = high (red)
        palette: ['ffffbf', 'fdae61', 'd7191c'],
        min: 1,
        max: 3,
        label: {
            vi: 'Nguy cơ theo mưa (phân lớp)',
            en: 'Rain-based Flood Risk (classified)',
        },
    },
});

const M4_LAYERS = Object.freeze({
    affected_population: {
        // Population count per pixel — grey → red.
        palette: ['f7f4f9', 'd4b9da', 'df65b0', 'ce1256', '67001f'],
        min: 0,
        max: 100,
        label: {
            vi: 'Dân cư bị ảnh hưởng',
            en: 'Affected population',
        },
    },
    affected_cropland: {
        palette: ['74C476'],
        min: 1,
        max: 1,
        label: {
            vi: 'Đất trồng trọt bị ảnh hưởng',
            en: 'Affected cropland',
        },
    },
    affected_built: {
        palette: ['C2185B'],
        min: 1,
        max: 1,
        label: {
            vi: 'Khu vực đô thị bị ảnh hưởng',
            en: 'Affected built-up',
        },
    },
});

// ── Giám sát ngập theo kỳ (TREND_MONITORING_V1 pipeline) ────────────────────
// Palettes and ranges derived from new_code.js §9 (Map.addLayer calls).
const M5_FINAL_LAYERS = Object.freeze({
    // ── Kết quả chính ────────────────────────────────────────────────────────
    flood_extent: {
        palette: ['1f78b4'],
        min: 1,
        max: 1,
        label: {
            vi: 'Vùng ghi nhận ngập',
            en: 'Detected flood extent',
        },
    },
    // ── Ảnh hưởng ────────────────────────────────────────────────────────────
    pop_affected: {
        // Yellow → dark red (5 stops — new_code.js §9, layer 2)
        palette: ['FFFFB2', 'FECC5C', 'FD8D3C', 'F03B20', 'BD0026'],
        min: 0,
        max: 50,
        label: {
            vi: 'Dân số trong vùng ảnh hưởng',
            en: 'Affected population',
        },
    },
    crop_affected: {
        palette: ['238B45'],   // new_code.js §9, layer 3
        min: 1,
        max: 1,
        label: {
            vi: 'Cây trồng trong vùng ảnh hưởng',
            en: 'Affected cropland',
        },
    },
    built_affected: {
        palette: ['C2185B'],
        min: 1,
        max: 1,
        label: {
            vi: 'Khu xây dựng trong vùng ảnh hưởng',
            en: 'Affected built-up',
        },
    },
    // ── Cảnh báo / rủi ro ────────────────────────────────────────────────────
    encroachment_alert: {
        palette: ['DE2D26'],   // new_code.js §9, layer 4
        min: 1,
        max: 1,
        label: {
            vi: 'Cảnh báo tiêu thoát',
            en: 'Drainage encroachment alert',
        },
    },
    drainage_sensitive: {
        palette: ['756BB1'],   // new_code.js §9, layer 5
        min: 1,
        max: 1,
        label: {
            vi: 'Vùng nhạy cảm tiêu thoát',
            en: 'Drainage-sensitive area',
        },
    },
    pond_to_built: {
        palette: ['FEB24C'],   // new_code.js §9, layer 6
        min: 1,
        max: 1,
        label: {
            vi: 'Ao/mặt nước chuyển thành khu xây dựng',
            en: 'Pond-to-built',
        },
    },
    // ── QA ────────────────────────────────────────────────────────────────────
    // frequent_flood: binary 0/1 (with freqAlertMin=1, equals flood_extent)
    frequent_flood: {
        palette: ['08519C'],
        min: 1,
        max: 1,
        label: { vi: 'Phát hiện ngập (QA)', en: 'Flood detection flag (QA)' },
    },
    // flood_frequency: raw count (0 or 1 in single-period model)
    flood_frequency: {
        palette: ['f7f7f7', '1f78b4'],
        min: 0,
        max: 1,
        label: { vi: 'Tần số phát hiện ngập (QA)', en: 'Flood frequency count (QA)' },
    },
    // stratum: 1=non-urban (#2ca25f), 2=urban (#de2d26), 3=mine/bare (#8c6bb1)
    stratum: {
        palette: ['2ca25f', 'de2d26', '8c6bb1'],
        min: 1,
        max: 3,
        label: { vi: 'Phân tầng khu vực (QA)', en: 'Monitoring stratum (QA)' },
    },
});

const ARTIFACT_LAYER_DEFINITIONS = Object.freeze({
    ...M1_LAYERS,
    ...M2_LAYERS,
    ...M3_LAYERS,
    ...M4_LAYERS,
    ...M5_FINAL_LAYERS,
});

// Maps each artifact_code to its module name.
const ARTIFACT_MODULE_MAP = Object.freeze({
    ...Object.fromEntries(Object.keys(M1_LAYERS).map(k => [k, 'event'])),
    ...Object.fromEntries(Object.keys(M2_LAYERS).map(k => [k, 'hand'])),
    ...Object.fromEntries(Object.keys(M3_LAYERS).map(k => [k, 'rain'])),
    ...Object.fromEntries(Object.keys(M4_LAYERS).map(k => [k, 'impact'])),
    ...Object.fromEntries(Object.keys(M5_FINAL_LAYERS).map(k => [k, 'trend'])),
});

/**
 * Get the layer definition for an artifact code — throws for unknown codes so
 * a typo doesn't silently render as a blank layer.
 */
function getLayerDefinition(artifactCode) {
    const def = ARTIFACT_LAYER_DEFINITIONS[artifactCode];
    if (!def) {
        throw new Error(`visualization.getLayerDefinition: no definition for '${artifactCode}'`);
    }
    return def;
}

/**
 * All defined artifact codes, in module order (M1..M5). Useful for admin
 * dashboards that need to iterate the full catalog.
 */
function listArtifactCodes() {
    return Object.freeze([
        ...Object.keys(M1_LAYERS),
        ...Object.keys(M2_LAYERS),
        ...Object.keys(M3_LAYERS),
        ...Object.keys(M4_LAYERS),
        ...Object.keys(M5_FINAL_LAYERS),
    ]);
}

module.exports = {
    ARTIFACT_LAYER_DEFINITIONS,
    ARTIFACT_MODULE_MAP,
    M1_LAYERS,
    M2_LAYERS,
    M3_LAYERS,
    M4_LAYERS,
    M5_FINAL_LAYERS,
    getLayerDefinition,
    listArtifactCodes,
};
