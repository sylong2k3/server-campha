'use strict';

/**
 * M3 rain-risk artifact catalog + result metadata builder.
 *
 * §16 non-negotiable — every UI label MUST use "Nguy cơ theo mưa" /
 * "Rain-based Flood Risk" (or "Chỉ số rủi ro" for the numeric band).
 * NEVER say "Xác suất" / "Probability". The
 * `metadata.PROBABILITY_CALIBRATED = false` flag makes this machine-readable.
 */

const { PROBABILITY_CALIBRATED } = require('./risk-model');

const M3_ARTIFACTS = Object.freeze([
    {
        code: 'rain_risk_score',
        role: 'PRODUCT',
        label: {
            vi: 'Chỉ số rủi ro (mưa)',
            en: 'Rain Risk Index (0..1)',
        },
        description:
            'Continuous 0..1 rain-based flood Risk Index. NOT a calibrated probability — see PROBABILITY_CALIBRATED metadata flag.',
        style: 'rain_risk_score',
    },
    {
        code: 'rain_risk_class',
        role: 'PRODUCT',
        label: {
            vi: 'Nguy cơ theo mưa (phân lớp)',
            en: 'Rain-based Flood Risk (classified)',
        },
        description:
            '3-class band (1 low / 2 medium / 3 high). Cut-offs derived from the caller-supplied threshold.',
        style: 'rain_risk_class',
    },
]);

const CODE_TO_ARTIFACT = Object.freeze(Object.fromEntries(M3_ARTIFACTS.map((a) => [a.code, a])));

function selectM3Artifacts({ runMode = 'product' } = {}) {
    return M3_ARTIFACTS.map((a) => ({
        ...a,
        role: runMode === 'calibration' && a.role === 'QA' ? 'CALIBRATION' : a.role,
    }));
}

/**
 * Build the metadata JSON that goes on the flood_artifacts row.
 * PROBABILITY_CALIBRATED is copied through so downstream consumers can hard-
 * fail if it ever flips true without a scientific calibration commit.
 */
function buildM3ResultMetadata({
    source,
    eventTime,
    threshold,
    weights,
    rainMm3h = null,
    rainMm24h = null,
    rainMm7d = null,
    highRiskAreaHa = null,
    warnings = [],
} = {}) {
    return {
        source: source || null,
        eventTime: eventTime || null,
        threshold: Number.isFinite(threshold) ? threshold : null,
        weights: weights || null,
        rainMm3h: Number.isFinite(rainMm3h) ? rainMm3h : null,
        rainMm24h: Number.isFinite(rainMm24h) ? rainMm24h : null,
        rainMm7d: Number.isFinite(rainMm7d) ? rainMm7d : null,
        highRiskAreaHa: Number.isFinite(highRiskAreaHa) ? highRiskAreaHa : null,
        PROBABILITY_CALIBRATED,
        warnings: Array.isArray(warnings) ? warnings : [],
    };
}

module.exports = {
    M3_ARTIFACTS,
    CODE_TO_ARTIFACT,
    selectM3Artifacts,
    buildM3ResultMetadata,
};
