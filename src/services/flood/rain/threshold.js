'use strict';

/**
 * Convert the continuous rain-risk score (0..1) into a classified band
 * (low / medium / high).
 *
 * The single-cutoff `threshold` (default 0.60 per Flood_D:235) separates
 * "flagged" pixels from the rest — used by the map UI to draw the risk zone
 * outline. The three-class band adds a middle "medium" tier so the client
 * can render a proper legend.
 *
 * Class integer IDs (used in the published raster):
 *   1 = low
 *   2 = medium
 *   3 = high
 *
 * @source docs/Flood_D_final.js (rainRisk.threshold:235)
 */

const CLASS_ID = Object.freeze({ low: 1, medium: 2, high: 3 });

/**
 * Binary threshold mask — > threshold = 1, else 0.
 */
function thresholdMask(ee, riskScoreImage, threshold) {
    if (!ee) {
        throw new Error('rain.threshold.thresholdMask requires the ee module');
    }
    if (!riskScoreImage) {
        throw new Error('rain.threshold.thresholdMask requires a riskScoreImage');
    }
    if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) {
        throw new Error('rain.threshold.thresholdMask requires a numeric threshold in [0, 1]');
    }
    return riskScoreImage.gte(threshold).rename('rain_risk_mask');
}

/**
 * 3-class rain-risk band (1/2/3). Uses `threshold - 0.15` and `threshold`
 * as the low/medium/high cutoffs so the "high" tier matches the binary mask.
 */
function classifyRiskBand(ee, riskScoreImage, threshold) {
    if (!ee) {
        throw new Error('rain.threshold.classifyRiskBand requires the ee module');
    }
    if (!riskScoreImage) {
        throw new Error('rain.threshold.classifyRiskBand requires a riskScoreImage');
    }
    if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) {
        throw new Error('rain.threshold.classifyRiskBand requires numeric threshold in [0, 1]');
    }
    const mediumCut = Math.max(0, threshold - 0.15);
    return ee
        .Image(CLASS_ID.low)
        .where(riskScoreImage.gte(mediumCut), CLASS_ID.medium)
        .where(riskScoreImage.gte(threshold), CLASS_ID.high)
        .rename('rain_risk_class');
}

module.exports = {
    CLASS_ID,
    thresholdMask,
    classifyRiskBand,
};
