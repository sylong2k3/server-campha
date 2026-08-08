'use strict';

const Joi = require('joi');

// Toàn bộ giá trị DB cho phép (khớp CHECK constraint kttv.sources.service_type).
const SERVICE_TYPES = ['REST', 'WMS', 'WMTS', 'WFS', 'WCS', 'GEE', 'FTP'];
// Theo docs (Sprint 10a): chỉ nghiệm thu adapter REST/JSON trước — WMS/WMTS/WFS/WCS/
// GEE/FTP chưa có adapter riêng, KHÔNG được phép chọn dù cột DB đã cho phép giá trị
// này, để tránh hiểu nhầm service_type là bằng chứng đã hỗ trợ giao thức.
const IMPLEMENTED_SERVICE_TYPES = ['REST'];
const RESPONSE_FORMATS = ['JSON', 'GeoJSON', 'GeoTIFF', 'NetCDF', 'GRIB2', 'PNG'];
const STATION_TYPES = ['mua', 'thuy_van', 'hai_van', 'khi_tuong_be_mat'];

const id = Joi.number().integer().positive();
const date = Joi.date().iso();
const jsonConfig = Joi.object().unknown(true);
const finite = Joi.number().custom((value, helpers) =>
    Number.isFinite(value) ? value : helpers.error('number.base'),
);
const variableName = Joi.string()
    .trim()
    .pattern(/^[a-z][a-z0-9_]{1,49}$/);
const unit = Joi.string().trim().min(1).max(30);
const jsonPath = Joi.string()
    .trim()
    .pattern(/^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*$/)
    .max(300);
const mapping = Joi.object({
    path: jsonPath.required(),
    variable: variableName.required(),
    unit: unit.required(),
    factor: finite.default(1),
    offset: finite.default(0),
    min: finite,
    max: finite,
}).custom((value, helpers) =>
    value.min !== undefined && value.max !== undefined && value.min > value.max
        ? helpers.error('any.invalid')
        : value,
);
const sourceVariables = Joi.object({
    observedAtPath: jsonPath.required(),
    observedAtFormat: Joi.string().valid('iso', 'unix_seconds', 'unix_milliseconds').default('iso'),
    stationCode: Joi.string()
        .trim()
        .pattern(/^[A-Za-z0-9_-]{1,30}$/)
        .required(),
    mappings: Joi.array().items(mapping).min(1).max(50).unique('variable').required(),
});
const AUTH_METHODS = ['api_key', 'bearer', 'basic'];
const credential = Joi.object({
    apiKey: Joi.string().max(500),
    token: Joi.string().max(2000),
    username: Joi.string().max(500),
    password: Joi.string().max(500).allow(''),
})
    .custom((value, helpers) => {
        if (!Object.values(value).some((item) => item !== undefined)) {
            return helpers.error('object.min');
        }
        return value;
    })
    .max(4);

const validateSourceConfig = (value, helpers) => {
    const authRequirements = {
        api_key: 'apiKey',
        bearer: 'token',
        basic: 'username',
    };
    if (value.authMethod) {
        const requiredKey = authRequirements[value.authMethod];
        if (!value.credential?.[requiredKey]) {
            return helpers.error('any.invalid');
        }
    }
    if (value.credential && !value.authMethod) {
        return helpers.error('any.invalid');
    }
    if ((value.isEnabled || value.cronExpr) && value.responseFormat !== 'JSON') {
        return helpers.error('any.invalid');
    }
    return value;
};

// ─── kttv.sources ────────────────────────────────────────────────────────────

const sourceListSchema = Joi.object({
    q: Joi.string().trim().max(100),
    serviceType: Joi.string().valid(...IMPLEMENTED_SERVICE_TYPES),
    isEnabled: Joi.boolean(),
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(20),
});

const sourceCreateSchema = Joi.object({
    name: Joi.string().trim().min(1).max(200).required(),
    provider: Joi.string().trim().max(200).allow(null, ''),
    serviceType: Joi.string()
        .valid(...IMPLEMENTED_SERVICE_TYPES)
        .required(),
    endpointUrl: Joi.string()
        .uri({ scheme: ['http', 'https'] })
        .max(2000)
        .required(),
    authMethod: Joi.string()
        .valid(...AUTH_METHODS)
        .allow(null, ''),
    credential: credential.allow(null),
    rateLimitPerMin: Joi.number().integer().positive().max(100000),
    rateLimitPerDay: Joi.number().integer().positive().max(10000000),
    responseFormat: Joi.string()
        .valid(...RESPONSE_FORMATS)
        .allow(null, ''),
    licenseNote: Joi.string().trim().max(2000).allow(null, ''),
    spatialConfig: jsonConfig,
    temporalConfig: jsonConfig,
    variables: sourceVariables,
    displayConfig: jsonConfig,
    cronExpr: Joi.string().trim().max(50).allow(null, ''),
    retryCount: Joi.number().integer().min(0).max(10).default(3),
    retryDelaySec: Joi.number().integer().min(1).max(3600).default(60),
    isEnabled: Joi.boolean().default(false),
}).custom(validateSourceConfig);

// Viết tách riêng (không .fork() từ createSchema) để KHÔNG có .default() nào —
// tránh Joi tự điền giá trị mặc định vào các field người dùng không gửi, dẫn tới
// PATCH một phần ghi đè nhầm các cột khác về giá trị mặc định.
const sourceUpdateSchema = Joi.object({
    name: Joi.string().trim().min(1).max(200),
    provider: Joi.string().trim().max(200).allow(null, ''),
    serviceType: Joi.string().valid(...IMPLEMENTED_SERVICE_TYPES),
    endpointUrl: Joi.string()
        .uri({ scheme: ['http', 'https'] })
        .max(2000),
    authMethod: Joi.string()
        .valid(...AUTH_METHODS)
        .allow(null, ''),
    credential: credential.allow(null),
    rateLimitPerMin: Joi.number().integer().positive().max(100000).allow(null),
    rateLimitPerDay: Joi.number().integer().positive().max(10000000).allow(null),
    responseFormat: Joi.string()
        .valid(...RESPONSE_FORMATS)
        .allow(null, ''),
    licenseNote: Joi.string().trim().max(2000).allow(null, ''),
    spatialConfig: jsonConfig,
    temporalConfig: jsonConfig,
    variables: sourceVariables,
    displayConfig: jsonConfig,
    cronExpr: Joi.string().trim().max(50).allow(null, ''),
    retryCount: Joi.number().integer().min(0).max(10),
    retryDelaySec: Joi.number().integer().min(1).max(3600),
    isEnabled: Joi.boolean(),
    expectedUpdatedAt: date.required(),
})
    .min(2)
    .custom((value, helpers) => {
        if (value.authMethod && value.credential) {
            return validateSourceConfig(value, helpers);
        }
        if (value.credential && !value.authMethod) {
            return helpers.error('any.invalid');
        }
        if (
            (value.isEnabled || value.cronExpr) &&
            value.responseFormat &&
            value.responseFormat !== 'JSON'
        ) {
            return helpers.error('any.invalid');
        }
        return value;
    });

const sourceIdParamsSchema = Joi.object({ id: id.required() });
const deleteQuerySchema = Joi.object({ expectedUpdatedAt: date.required() });

// ─── kttv.stations ───────────────────────────────────────────────────────────

const stationCode = Joi.string()
    .trim()
    .pattern(/^[A-Za-z0-9_-]{1,30}$/);
// Docs (Sprint 10a, cập nhật): cho phép chọn trạm lân cận NGOÀI Cẩm Phả để nội suy
// (Thiessen/IDW) — không còn giới hạn cứng trong ranh thành phố. Dùng ranh giới quốc
// gia Việt Nam (có biên độ nhỏ cho trạm biên giới liên quan lưu vực sông) thay vì
// unbounded, để vẫn chặn được lỗi nhập liệu tọa độ sai lệch hoàn toàn.
const longitude = Joi.number().min(102).max(110);
const latitude = Joi.number().min(8).max(24);

const stationListSchema = Joi.object({
    q: Joi.string().trim().max(100),
    stationType: Joi.string().valid(...STATION_TYPES),
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(20),
});

const stationCreateSchema = Joi.object({
    code: stationCode.required(),
    name: Joi.string().trim().min(1).max(200).required(),
    stationType: Joi.string()
        .valid(...STATION_TYPES)
        .allow(null),
    longitude: longitude.required(),
    latitude: latitude.required(),
    elevationM: Joi.number().min(-500).max(9000).allow(null),
    managingOrg: Joi.string().trim().max(200).allow(null, ''),
    thiessenWeight: Joi.number().min(0).max(1).allow(null),
    alarmLevel1M: Joi.number().min(-100).max(1000).allow(null),
    alarmLevel2M: Joi.number().min(Joi.ref('alarmLevel1M')).max(1000).allow(null),
    alarmLevel3M: Joi.number().min(Joi.ref('alarmLevel2M')).max(1000).allow(null),
    isUsedForBasin: Joi.boolean().default(true),
});

const stationUpdateSchema = Joi.object({
    name: Joi.string().trim().min(1).max(200),
    stationType: Joi.string()
        .valid(...STATION_TYPES)
        .allow(null),
    longitude,
    latitude,
    elevationM: Joi.number().min(-500).max(9000).allow(null),
    managingOrg: Joi.string().trim().max(200).allow(null, ''),
    thiessenWeight: Joi.number().min(0).max(1).allow(null),
    alarmLevel1M: Joi.number().min(-100).max(1000).allow(null),
    alarmLevel2M: Joi.number().min(0).max(1000).allow(null),
    alarmLevel3M: Joi.number().min(0).max(1000).allow(null),
    isUsedForBasin: Joi.boolean(),
    expectedUpdatedAt: date.required(),
})
    .min(2)
    .custom((value, helpers) => {
        // longitude/latitude phải đi cùng nhau khi cập nhật vị trí trạm.
        if ((value.longitude !== undefined) !== (value.latitude !== undefined)) {
            return helpers.error('any.invalid');
        }
        return value;
    });

const stationCodeParamsSchema = Joi.object({ code: stationCode.required() });

// ─── Scenarios + input batches ────────────────────────────────────────────────

const condition = Joi.object({
    variable: variableName.required(),
    unit: unit.required(),
    op: Joi.string().valid('eq', 'gt', 'gte', 'lt', 'lte', 'between').required(),
    value: Joi.alternatives().conditional('op', {
        is: 'between',
        then: Joi.array()
            .items(finite.required())
            .length(2)
            .custom((range, helpers) =>
                range[0] <= range[1] ? range : helpers.error('any.invalid'),
            ),
        otherwise: finite.required(),
    }),
});
const matchRule = Joi.object({
    all: Joi.array().items(condition).min(1).max(20),
    any: Joi.array().items(condition).min(1).max(20),
}).xor('all', 'any');
const scenarioCode = Joi.string()
    .trim()
    .uppercase()
    .pattern(/^[A-Z0-9][A-Z0-9_-]{1,79}$/);
const scenarioListSchema = Joi.object({
    q: Joi.string().trim().max(100),
    status: Joi.string().valid('draft', 'official', 'archived'),
    isEnabled: Joi.boolean(),
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(20),
});
const scenarioCreateSchema = Joi.object({
    code: scenarioCode.required(),
    name: Joi.string().trim().min(1).max(200).required(),
    description: Joi.string().trim().max(5000).allow(null, ''),
    matchRule: matchRule.required(),
    matchPriority: Joi.number().integer().min(1).max(10000).default(100),
    effectiveFrom: date.allow(null),
    effectiveTo: date.allow(null),
}).custom((value, helpers) =>
    value.effectiveFrom && value.effectiveTo && value.effectiveFrom >= value.effectiveTo
        ? helpers.error('any.invalid')
        : value,
);
const scenarioUpdateSchema = Joi.object({
    name: Joi.string().trim().min(1).max(200),
    description: Joi.string().trim().max(5000).allow(null, ''),
    matchRule,
    matchPriority: Joi.number().integer().min(1).max(10000),
    effectiveFrom: date.allow(null),
    effectiveTo: date.allow(null),
    expectedUpdatedAt: date.required(),
})
    .min(2)
    .custom((value, helpers) =>
        value.effectiveFrom && value.effectiveTo && value.effectiveFrom >= value.effectiveTo
            ? helpers.error('any.invalid')
            : value,
    );
const scenarioIdParamsSchema = Joi.object({ id: id.required() });
const scenarioPublishSchema = Joi.object({
    expectedUpdatedAt: date.required(),
    isEnabled: Joi.boolean().default(true),
});
const reading = Joi.object({ value: finite.required(), unit: unit.required() });
const manualInputSchema = Joi.object({
    stationCode: stationCode.required(),
    observedAt: date.required(),
    values: Joi.object().pattern(variableName, reading).min(1).max(50).required(),
});
const inputListSchema = Joi.object({
    inputMode: Joi.string().valid('automatic', 'manual'),
    matchStatus: Joi.string().valid('matched', 'no_match', 'ambiguous'),
    stationCode,
    from: date,
    to: date,
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(20),
});
const inputIdParamsSchema = Joi.object({ id: id.required() });

module.exports = {
    SERVICE_TYPES,
    IMPLEMENTED_SERVICE_TYPES,
    RESPONSE_FORMATS,
    STATION_TYPES,
    AUTH_METHODS,
    sourceListSchema,
    sourceCreateSchema,
    sourceUpdateSchema,
    sourceIdParamsSchema,
    deleteQuerySchema,
    stationListSchema,
    stationCreateSchema,
    stationUpdateSchema,
    stationCodeParamsSchema,
    sourceVariables,
    matchRule,
    scenarioListSchema,
    scenarioCreateSchema,
    scenarioUpdateSchema,
    scenarioIdParamsSchema,
    scenarioPublishSchema,
    manualInputSchema,
    inputListSchema,
    inputIdParamsSchema,
};
