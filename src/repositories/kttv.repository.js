'use strict';

const db = require('../configs/database');
const { versionCondition } = require('../utils/optimistic-lock.util');

const pageResult = (rows) => ({
    items: rows.map(({ total_count: _total, ...row }) => row),
    total: rows[0]?.total_count || 0,
});
const paginate = (params, page, limit) => {
    params.push(limit, (page - 1) * limit);
    return `LIMIT $${params.length - 1} OFFSET $${params.length}`;
};

// ─────────────────────────────────────────────────────────────────────────────
// kttv.sources
// ─────────────────────────────────────────────────────────────────────────────

const SOURCE_COLUMNS = `id,name,provider,service_type,endpoint_url,auth_method,credential_enc,
    rate_limit_per_min,rate_limit_per_day,response_format,license_note,spatial_config,
    temporal_config,variables,display_config,cron_expr,retry_count,retry_delay_sec,
    fallback_source_id,is_enabled,created_at,updated_at`;

const listSources = async (filter) => {
    const params = [];
    const conditions = ['TRUE'];
    if (filter.q) {
        params.push(`%${filter.q}%`);
        conditions.push(`unaccent(lower(name)) ILIKE unaccent(lower($${params.length}))`);
    }
    if (filter.serviceType) {
        params.push(filter.serviceType);
        conditions.push(`service_type=$${params.length}`);
    }
    if (filter.isEnabled !== undefined) {
        params.push(filter.isEnabled);
        conditions.push(`is_enabled=$${params.length}`);
    }
    const paging = paginate(params, filter.page, filter.limit);
    const { rows } = await db.query(
        `SELECT ${SOURCE_COLUMNS},COUNT(*) OVER()::int total_count
         FROM kttv.sources WHERE ${conditions.join(' AND ')}
         ORDER BY id DESC ${paging}`,
        params,
    );
    return pageResult(rows);
};

const findSource = async (id) => {
    const {
        rows: [row],
    } = await db.query(`SELECT ${SOURCE_COLUMNS} FROM kttv.sources WHERE id=$1`, [id]);
    return row || null;
};

const createSource = async (input) => {
    const {
        rows: [row],
    } = await db.query(
        `INSERT INTO kttv.sources(
            name,provider,service_type,endpoint_url,auth_method,credential_enc,
            rate_limit_per_min,rate_limit_per_day,response_format,license_note,
            spatial_config,temporal_config,variables,display_config,
            cron_expr,retry_count,retry_delay_sec,fallback_source_id,is_enabled
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
         RETURNING ${SOURCE_COLUMNS}`,
        [
            input.name,
            input.provider || null,
            input.serviceType,
            input.endpointUrl,
            input.authMethod || null,
            input.credentialEnc || null,
            input.rateLimitPerMin || null,
            input.rateLimitPerDay || null,
            input.responseFormat || null,
            input.licenseNote || null,
            JSON.stringify(input.spatialConfig || {}),
            JSON.stringify(input.temporalConfig || {}),
            JSON.stringify(input.variables || {}),
            JSON.stringify(input.displayConfig || {}),
            input.cronExpr || null,
            input.retryCount ?? 3,
            input.retryDelaySec ?? 60,
            input.fallbackSourceId || null,
            input.isEnabled ?? false,
        ],
    );
    return row;
};

const updateSource = async (id, input) => {
    const sets = [];
    const params = [];
    const push = (column, value) => {
        params.push(value);
        sets.push(`${column}=$${params.length}`);
    };
    const scalarFields = {
        name: 'name',
        provider: 'provider',
        serviceType: 'service_type',
        endpointUrl: 'endpoint_url',
        authMethod: 'auth_method',
        rateLimitPerMin: 'rate_limit_per_min',
        rateLimitPerDay: 'rate_limit_per_day',
        responseFormat: 'response_format',
        licenseNote: 'license_note',
        cronExpr: 'cron_expr',
        retryCount: 'retry_count',
        retryDelaySec: 'retry_delay_sec',
        fallbackSourceId: 'fallback_source_id',
        isEnabled: 'is_enabled',
    };
    for (const [key, column] of Object.entries(scalarFields)) {
        if (input[key] !== undefined) {
            push(column, input[key] === '' ? null : input[key]);
        }
    }
    const jsonFields = {
        spatialConfig: 'spatial_config',
        temporalConfig: 'temporal_config',
        variables: 'variables',
        displayConfig: 'display_config',
    };
    for (const [key, column] of Object.entries(jsonFields)) {
        if (input[key] !== undefined) {
            push(column, JSON.stringify(input[key]));
        }
    }
    if (input.credentialEnc !== undefined) {
        push('credential_enc', input.credentialEnc);
    }
    if (!sets.length) {
        return findSource(id);
    }
    params.push(id);
    const idIndex = params.length;
    params.push(input.expectedUpdatedAt);
    const version = versionCondition(params.length);
    const {
        rows: [row],
    } = await db.query(
        `UPDATE kttv.sources SET ${sets.join(',')} WHERE id=$${idIndex}${version}
         RETURNING ${SOURCE_COLUMNS}`,
        params,
    );
    return row || null;
};

const deleteSource = async (id, expectedUpdatedAt) => {
    const params = [id, expectedUpdatedAt];
    const version = versionCondition(2);
    const {
        rows: [row],
    } = await db.query(`DELETE FROM kttv.sources WHERE id=$1${version} RETURNING id`, params);
    return row || null;
};

// ─────────────────────────────────────────────────────────────────────────────
// kttv.stations (PK = code)
// ─────────────────────────────────────────────────────────────────────────────

const STATION_COLUMNS = `code,name,station_type,ST_X(geom::geometry) AS longitude,
    ST_Y(geom::geometry) AS latitude,elevation_m,managing_org,thiessen_weight,
    alarm_level_1_m,alarm_level_2_m,alarm_level_3_m,is_used_for_basin,created_at,updated_at`;

const listStations = async (filter) => {
    const params = [];
    const conditions = ['TRUE'];
    if (filter.q) {
        params.push(`%${filter.q}%`);
        conditions.push(
            `(unaccent(lower(name)) ILIKE unaccent(lower($${params.length})) OR unaccent(lower(code)) ILIKE unaccent(lower($${params.length})))`,
        );
    }
    if (filter.stationType) {
        params.push(filter.stationType);
        conditions.push(`station_type=$${params.length}`);
    }
    const paging = paginate(params, filter.page, filter.limit);
    const { rows } = await db.query(
        `SELECT ${STATION_COLUMNS},COUNT(*) OVER()::int total_count
         FROM kttv.stations WHERE ${conditions.join(' AND ')}
         ORDER BY code ${paging}`,
        params,
    );
    return pageResult(rows);
};

const findStation = async (code) => {
    const {
        rows: [row],
    } = await db.query(`SELECT ${STATION_COLUMNS} FROM kttv.stations WHERE code=$1`, [code]);
    return row || null;
};

const createStation = async (input) => {
    const {
        rows: [row],
    } = await db.query(
        `INSERT INTO kttv.stations(
            code,name,station_type,geom,elevation_m,managing_org,thiessen_weight,
            alarm_level_1_m,alarm_level_2_m,alarm_level_3_m,is_used_for_basin
         ) VALUES ($1,$2,$3,ST_SetSRID(ST_MakePoint($4,$5),4326),$6,$7,$8,$9,$10,$11,$12)
         RETURNING ${STATION_COLUMNS}`,
        [
            input.code,
            input.name,
            input.stationType || null,
            input.longitude,
            input.latitude,
            input.elevationM ?? null,
            input.managingOrg || null,
            input.thiessenWeight ?? null,
            input.alarmLevel1M ?? null,
            input.alarmLevel2M ?? null,
            input.alarmLevel3M ?? null,
            input.isUsedForBasin ?? true,
        ],
    );
    return row;
};

const updateStation = async (code, input) => {
    const sets = [];
    const params = [];
    const push = (column, value) => {
        params.push(value);
        sets.push(`${column}=$${params.length}`);
    };
    const scalarFields = {
        name: 'name',
        stationType: 'station_type',
        elevationM: 'elevation_m',
        managingOrg: 'managing_org',
        thiessenWeight: 'thiessen_weight',
        alarmLevel1M: 'alarm_level_1_m',
        alarmLevel2M: 'alarm_level_2_m',
        alarmLevel3M: 'alarm_level_3_m',
        isUsedForBasin: 'is_used_for_basin',
    };
    for (const [key, column] of Object.entries(scalarFields)) {
        if (input[key] !== undefined) {
            push(column, input[key] === '' ? null : input[key]);
        }
    }
    if (input.longitude !== undefined && input.latitude !== undefined) {
        params.push(input.longitude, input.latitude);
        sets.push(`geom=ST_SetSRID(ST_MakePoint($${params.length - 1},$${params.length}),4326)`);
    }
    if (!sets.length) {
        return findStation(code);
    }
    params.push(code);
    const codeIndex = params.length;
    params.push(input.expectedUpdatedAt);
    const version = versionCondition(params.length);
    const {
        rows: [row],
    } = await db.query(
        `UPDATE kttv.stations SET ${sets.join(',')} WHERE code=$${codeIndex}${version}
         RETURNING ${STATION_COLUMNS}`,
        params,
    );
    return row || null;
};

const deleteStation = async (code, expectedUpdatedAt) => {
    const params = [code, expectedUpdatedAt];
    const version = versionCondition(2);
    const {
        rows: [row],
    } = await db.query(`DELETE FROM kttv.stations WHERE code=$1${version} RETURNING code`, params);
    return row || null;
};

module.exports = {
    listSources,
    findSource,
    createSource,
    updateSource,
    deleteSource,
    listStations,
    findStation,
    createStation,
    updateStation,
    deleteStation,
};
