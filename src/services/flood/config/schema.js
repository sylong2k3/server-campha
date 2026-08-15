'use strict';

/**
 * Joi schemas for flood run configurations. The admin submit endpoint runs an
 * incoming payload through `validateRunConfig(module, payload)` before we
 * persist it or forward it to the queue.
 *
 * The schemas are strict: every unknown key is rejected, so a client can't
 * silently smuggle a non-Postman parameter into an EE graph.
 */

const Joi = require('joi');

const iso8601Date = Joi.string()
    .pattern(/^\d{4}-\d{2}-\d{2}$/)
    .messages({
        'string.pattern.base': 'expected ISO-8601 date (YYYY-MM-DD)',
    });

const modeSchema = Joi.string().valid('product', 'calibration').default('product');

// ── M1 (Sentinel-1 event) ────────────────────────────────────────────────────
const eventSchema = Joi.object({
    mode: modeSchema,
    // Sentinel-1 windows — CHECK: preEnd >= preStart, postEnd >= postStart.
    preStart: iso8601Date.required(),
    preEnd: iso8601Date.required(),
    postStart: iso8601Date.required(),
    postEnd: iso8601Date.required(),
    // Optional. Falls back to Flood_D:159–160 dry-window when running FP tests.
    falsePositivePostStart: iso8601Date,
    falsePositivePostEnd: iso8601Date,
    orbitPass: Joi.string().valid('AUTO', 'ASCENDING', 'DESCENDING').default('AUTO'),
    thresholdMode: Joi.string().valid('fixed', 'otsu', 'median_sigma').default('fixed'),
    // Every knob below defaults to values captured in defaults.js — they are
    // OPTIONAL overrides for calibration mode; production runs should leave them
    // unset so the defaults apply.
    medianSigmaK: Joi.number().min(0.5).max(10),
    vhFallbackDb: Joi.number(),
    otsuMinDb: Joi.number(),
    otsuMaxDb: Joi.number(),
    hardMaximumSlope: Joi.number().min(0).max(45),
    hardMaximumHAND: Joi.number().min(0).max(100),
    minimumVotes: Joi.number().integer().min(1).max(20),
    minimumObservations: Joi.number().integer().min(1).max(20),
    minimumVoteFraction: Joi.number().min(0).max(1),
    minimumAreaM2: Joi.number().min(0),
    minimumDarkSupportVotes: Joi.number().integer().min(0).max(10),
    eventMode: Joi.boolean(),
    enableShallowFlood: Joi.boolean(),
    shallowExtraDecreaseDb: Joi.number(),
    shallowPostVHDb: Joi.number(),
    enableUrbanDoubleBounce: Joi.boolean(),
    // Impact toggle (run M4 as a follow-up).
    runImpactAfterM1: Joi.boolean().default(true),
})
    .custom((value, helpers) => {
        if (value.preStart > value.preEnd) {
            return helpers.message('preStart must be <= preEnd');
        }
        if (value.postStart > value.postEnd) {
            return helpers.message('postStart must be <= postEnd');
        }
        if (
            (value.falsePositivePostStart && !value.falsePositivePostEnd) ||
            (!value.falsePositivePostStart && value.falsePositivePostEnd)
        ) {
            return helpers.message(
                'falsePositivePostStart and falsePositivePostEnd must both be set or both omitted',
            );
        }
        return value;
    }, 'event-window-consistency')
    .unknown(false);

// ── M2 (HAND scenario) ───────────────────────────────────────────────────────
const handSchema = Joi.object({
    mode: modeSchema,
    // Scenario inundation level (m) — defaults to Flood_D:227 = 5.
    levelM: Joi.number().min(0).max(50).default(5),
    maximumSlope: Joi.number().min(0).max(45).default(12),
}).unknown(false);

// ── M3 (Rain-based Risk Index) ───────────────────────────────────────────────
const rainSchema = Joi.object({
    mode: modeSchema,
    // 'IMERG' fetches from the IMERG collection; 'MANUAL' uses supplied rainfall.
    source: Joi.string().valid('IMERG', 'MANUAL').default('IMERG'),
    eventTime: Joi.string().isoDate(),
    // Only used when source='MANUAL'. Millimetres.
    rainfall: Joi.object({
        amount3h: Joi.number().min(0),
        amount6h: Joi.number().min(0),
        amount24h: Joi.number().min(0),
        amount72h: Joi.number().min(0),
        amount7d: Joi.number().min(0),
        amount30d: Joi.number().min(0),
    }),
    threshold: Joi.number().min(0).max(1).default(0.6),
})
    .custom((value, helpers) => {
        if (value.source === 'IMERG' && !value.eventTime) {
            return helpers.message('eventTime is required when source=IMERG');
        }
        if (value.source === 'MANUAL' && !value.rainfall) {
            return helpers.message('rainfall object is required when source=MANUAL');
        }
        return value;
    }, 'rain-source-consistency')
    .unknown(false);

// ── M4 (Impact) ──────────────────────────────────────────────────────────────
const impactSchema = Joi.object({
    mode: modeSchema,
    impactSource: Joi.string().valid('M1', 'M2', 'M3').default('M1'),
    impactUseNonTidal: Joi.boolean().default(true),
    // Optional — otherwise the orchestrator picks the caller's default AOI.
    sourceRunId: Joi.number().integer().positive(),
}).unknown(false);

// ── M5 (Trend) — reserved for GEE-S08 ────────────────────────────────────────
const trendSchema = Joi.object({
    mode: modeSchema,
    dryStart: iso8601Date.default('2023-01-01'),
    dryEnd: iso8601Date.default('2023-04-30'),
    periods: Joi.array()
        .items(
            Joi.object({
                start: iso8601Date.required(),
                end: iso8601Date.required(),
            }),
        )
        .min(2)
        .max(24)
        .default([
            { start: '2023-07-01', end: '2023-07-31' },
            { start: '2023-08-01', end: '2023-08-31' },
            { start: '2023-09-01', end: '2023-09-30' },
            { start: '2023-10-01', end: '2023-10-31' },
        ]),
    orbitPass: Joi.string().valid('AUTO', 'ASCENDING', 'DESCENDING').default('AUTO'),
    relativeOrbit: Joi.number().integer().min(1).max(175).allow(null).default(null),
    ratioThresholdMode: Joi.string().valid('fixed', 'otsu', 'median_sigma').default('fixed'),
    floodRatioThresholdVV: Joi.number().greater(1).max(5).default(1.2),
    floodRatioThresholdVH: Joi.number().greater(1).max(5).default(1.58),
    medianSigmaK: Joi.number().min(0.5).max(10).default(3.5),
    periodPadDays: Joi.number().integer().min(0).max(30).default(0),
    slopeThreshold: Joi.number().min(0).max(45).default(5),
    handThreshold: Joi.number().min(0).max(100).default(12),
    frequencyAlertPercent: Joi.number().min(0).max(100).default(50),
    dynamicWorldYearOld: Joi.number().integer().min(2015).max(2100).default(2018),
    dynamicWorldYearNew: Joi.number().integer().min(2015).max(2100).default(2023),
    enableUrbanDoubleBounce: Joi.boolean().default(false),
    validationPeriod: Joi.number().integer().min(0),
})
    .custom((value, helpers) => {
        if (value.dryStart > value.dryEnd) {
            return helpers.message('dryStart must be <= dryEnd');
        }
        if (value.dynamicWorldYearOld >= value.dynamicWorldYearNew) {
            return helpers.message('dynamicWorldYearOld must be < dynamicWorldYearNew');
        }
        for (const period of value.periods) {
            if (period.start > period.end) {
                return helpers.message('each trend period start must be <= end');
            }
        }
        if (
            value.validationPeriod !== null &&
            value.validationPeriod !== undefined &&
            value.validationPeriod >= value.periods.length
        ) {
            return helpers.message('validationPeriod must index an existing period');
        }
        return value;
    }, 'trend-consistency')
    .unknown(false);

// ── M6 (Forecast) — Kịch bản Lượng mưa + Thuỷ triều ───────────────────────────
const forecastSchema = Joi.object({
    mode: modeSchema,
    // Lượng mưa nhập tay (mm). amount24h bắt buộc; các khoảng khác là tùy chọn.
    rainfall: Joi.object({
        amount24h: Joi.number().min(0).max(2000).required().messages({
            'number.base': 'rainfall.amount24h phải là số (mm)',
            'any.required': 'rainfall.amount24h là bắt buộc',
        }),
        amount72h: Joi.number().min(0).max(5000),
        amount7d: Joi.number().min(0).max(15000),
    })
        .required()
        .messages({ 'any.required': 'rainfall object là bắt buộc' }),
    // Mực thuỷ triều (m, so với CDL/MSL).
    // Cẩm Phả thực tế: 0.0 – 3.5 m. Dải -1..10 cho phép nước rút và kịch bản cực đoan.
    tideLevelM: Joi.number().min(-1).max(10).required().messages({
        'number.base': 'tideLevelM phải là số (m)',
        'any.required': 'tideLevelM là bắt buộc',
    }),
    // Tham số mô hình — tùy chọn, có default từ FORECAST_DEFAULTS.
    rainfallCoefficient: Joi.number().min(0.1).max(10),
    maximumSlope: Joi.number().min(0).max(45),
    maximumHAND: Joi.number().min(0).max(100),
})
    .custom((value, helpers) => {
        // amount24h = 0 AND tideLevelM ≤ 0 ⇒ h_eff = 0 ⇒ kết quả trống: cảnh báo nhưng không reject.
        // (Operator có thể muốn chạy kịch bản "không mưa, triều rút" để baseline.)
        return value;
    }, 'forecast-level-check')
    .unknown(false);

const SCHEMAS = Object.freeze({
    event: eventSchema,
    hand: handSchema,
    rain: rainSchema,
    impact: impactSchema,
    trend: trendSchema,
    forecast: forecastSchema,
});

/**
 * @param {'event'|'hand'|'rain'|'impact'|'trend'} module
 * @param {object} payload
 * @returns {object} — normalised value with defaults applied
 * @throws  {Error} with .details listing every rejected key
 */
function validateRunConfig(module, payload) {
    const schema = SCHEMAS[module];
    if (!schema) {
        throw new Error(`Unknown flood module '${module}'`);
    }
    const { value, error } = schema.validate(payload || {}, {
        abortEarly: false,
        convert: true,
        stripUnknown: false,
    });
    if (error) {
        const message = error.details.map((d) => d.message).join('; ');
        const err = new Error(`Invalid ${module} run config: ${message}`);
        err.name = 'FloodConfigValidationError';
        err.details = error.details;
        throw err;
    }
    return value;
}

module.exports = {
    SCHEMAS,
    validateRunConfig,
};
