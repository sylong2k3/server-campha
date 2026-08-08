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
const queryOne = async (sql, params, client = db) => {
    const {
        rows: [row],
    } = await client.query(sql, params);
    return row || null;
};

// ─────────────────────────────────────────────────────────────────────────────
// kttv.sources
// ─────────────────────────────────────────────────────────────────────────────

const SOURCE_COLUMNS = `id,name,provider,service_type,endpoint_url,auth_method,credential_enc,
    rate_limit_per_min,rate_limit_per_day,response_format,license_note,
    spatial_config,temporal_config,variables,display_config,cron_expr,retry_count,retry_delay_sec,
    fallback_source_id,is_enabled,last_attempt_at,last_success_at,last_error_code,last_http_status,
    last_response_bytes,created_at,updated_at`;

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

const findSource = async (id) =>
    queryOne(`SELECT ${SOURCE_COLUMNS} FROM kttv.sources WHERE id=$1`, [id]);

const markCollectionSuccess = async (id, { httpStatus, responseBytes }) => {
    await db.query(
        `UPDATE kttv.sources SET last_attempt_at=NOW(),last_success_at=NOW(),last_error_code=NULL,
         last_http_status=$2,last_response_bytes=$3 WHERE id=$1`,
        [id, httpStatus, responseBytes],
    );
};

const markCollectionFailure = async (id, { errorCode, httpStatus, responseBytes }) => {
    await db.query(
        `UPDATE kttv.sources SET last_attempt_at=NOW(),last_error_code=$2,
         last_http_status=$3,last_response_bytes=$4 WHERE id=$1`,
        [
            id,
            String(errorCode || 'SOURCE_COLLECTION_FAILED').slice(0, 80),
            httpStatus,
            responseBytes,
        ],
    );
};

const listScheduledSources = async () => {
    const { rows } = await db.query(
        `SELECT ${SOURCE_COLUMNS} FROM kttv.sources
         WHERE is_enabled=true AND service_type='REST' AND response_format='JSON'
           AND cron_expr IS NOT NULL ORDER BY id`,
    );
    return rows;
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

// ─────────────────────────────────────────────────────────────────────────────
// hydro.scenarios + kttv.input_batches
// ─────────────────────────────────────────────────────────────────────────────

const SCENARIO_COLUMNS = `id,code,version,name,description,match_rule,match_priority,status,
    is_enabled,effective_from,effective_to,created_by,published_by,published_at,created_at,updated_at`;
const INPUT_COLUMNS = `b.id,b.input_mode,b.station_code,b.observed_at,b.values_snapshot,b.source_id,
    b.entered_by,b.match_status,b.scenario_id,b.candidate_scenario_ids,b.created_at`;
const INPUT_DETAIL_COLUMNS = `${INPUT_COLUMNS},b.raw_payload`;

const listScenarios = async (filter) => {
    const params = [];
    const conditions = ['TRUE'];
    if (filter.q) {
        params.push(`%${filter.q}%`);
        conditions.push(
            `(unaccent(lower(name)) ILIKE unaccent(lower($${params.length})) OR code ILIKE $${params.length})`,
        );
    }
    if (filter.status) {
        params.push(filter.status);
        conditions.push(`status=$${params.length}`);
    }
    if (filter.isEnabled !== undefined) {
        params.push(filter.isEnabled);
        conditions.push(`is_enabled=$${params.length}`);
    }
    const paging = paginate(params, filter.page, filter.limit);
    const { rows } = await db.query(
        `SELECT ${SCENARIO_COLUMNS},COUNT(*) OVER()::int total_count FROM hydro.scenarios
         WHERE ${conditions.join(' AND ')} ORDER BY code,version DESC ${paging}`,
        params,
    );
    return pageResult(rows);
};
const findScenario = async (id, client = db) =>
    queryOne(`SELECT ${SCENARIO_COLUMNS} FROM hydro.scenarios WHERE id=$1`, [id], client);
const createScenario = async (input, actor) => {
    const client = await db.getClient();
    try {
        await client.query('BEGIN');
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [input.code]);
        const {
            rows: [version],
        } = await client.query(
            `SELECT COALESCE(MAX(version),0)+1 next_version FROM hydro.scenarios WHERE code=$1`,
            [input.code],
        );
        const row = await queryOne(
            `INSERT INTO hydro.scenarios(code,version,name,description,match_rule,match_priority,
                effective_from,effective_to,created_by)
             VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING ${SCENARIO_COLUMNS}`,
            [
                input.code,
                version.next_version,
                input.name,
                input.description || null,
                JSON.stringify(input.matchRule),
                input.matchPriority,
                input.effectiveFrom || null,
                input.effectiveTo || null,
                actor.id,
            ],
            client,
        );
        await client.query('COMMIT');
        return row;
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
};
const updateScenario = async (id, input) => {
    const sets = [];
    const params = [];
    const push = (column, value) => {
        params.push(value);
        sets.push(`${column}=$${params.length}`);
    };
    const scalarFields = {
        name: 'name',
        description: 'description',
        matchPriority: 'match_priority',
        effectiveFrom: 'effective_from',
        effectiveTo: 'effective_to',
    };
    for (const [key, column] of Object.entries(scalarFields)) {
        if (input[key] !== undefined) {
            push(column, input[key] === '' ? null : input[key]);
        }
    }
    if (input.matchRule !== undefined) {
        push('match_rule', JSON.stringify(input.matchRule));
    }
    params.push(id, input.expectedUpdatedAt);
    const idIndex = params.length - 1;
    const version = versionCondition(params.length);
    return queryOne(
        `UPDATE hydro.scenarios SET ${sets.join(',')} WHERE id=$${idIndex} AND status='draft'${version}
         RETURNING ${SCENARIO_COLUMNS}`,
        params,
    );
};
const publishScenario = async (id, expectedUpdatedAt, isEnabled, actor) => {
    const client = await db.getClient();
    try {
        await client.query('BEGIN');
        const current = await queryOne(
            `SELECT ${SCENARIO_COLUMNS} FROM hydro.scenarios WHERE id=$1 FOR UPDATE`,
            [id],
            client,
        );
        if (!current) {
            await client.query('ROLLBACK');
            return { conflict: 'SCENARIO_NOT_FOUND' };
        }
        if (current.status !== 'draft') {
            await client.query('ROLLBACK');
            return { conflict: 'SCENARIO_NOT_DRAFT' };
        }
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [current.code]);
        if (isEnabled) {
            await client.query(
                `UPDATE hydro.scenarios SET status='archived',is_enabled=false
                 WHERE code=$1 AND status='official' AND is_enabled=true`,
                [current.code],
            );
        }
        const row = await queryOne(
            `UPDATE hydro.scenarios SET status='official',is_enabled=$2,published_by=$3,published_at=NOW()
             WHERE id=$1 AND status='draft'${versionCondition(4)} RETURNING ${SCENARIO_COLUMNS}`,
            [id, isEnabled, actor.id, expectedUpdatedAt],
            client,
        );
        if (!row) {
            await client.query('ROLLBACK');
            return { conflict: 'OPTIMISTIC_LOCK_CONFLICT' };
        }
        await client.query('COMMIT');
        return row;
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
};
const listMatchableScenarios = async (observedAt) => {
    const { rows } = await db.query(
        `SELECT ${SCENARIO_COLUMNS} FROM hydro.scenarios
         WHERE status='official' AND is_enabled=true
           AND (effective_from IS NULL OR effective_from <= $1)
           AND (effective_to IS NULL OR effective_to > $1)
         ORDER BY match_priority,id`,
        [observedAt],
    );
    return rows;
};

const listInputs = async (filter) => {
    const params = [];
    const conditions = ['TRUE'];
    const add = (value, sql) => {
        params.push(value);
        conditions.push(sql(params.length));
    };
    if (filter.inputMode) {
        add(filter.inputMode, (i) => `b.input_mode=$${i}`);
    }
    if (filter.matchStatus) {
        add(filter.matchStatus, (i) => `b.match_status=$${i}`);
    }
    if (filter.stationCode) {
        add(filter.stationCode, (i) => `b.station_code=$${i}`);
    }
    if (filter.from) {
        add(filter.from, (i) => `b.observed_at >= $${i}`);
    }
    if (filter.to) {
        add(filter.to, (i) => `b.observed_at < $${i}`);
    }
    const paging = paginate(params, filter.page, filter.limit);
    const { rows } = await db.query(
        `SELECT ${INPUT_COLUMNS},s.code scenario_code,s.version scenario_version,
            COUNT(*) OVER()::int total_count
         FROM kttv.input_batches b LEFT JOIN hydro.scenarios s ON s.id=b.scenario_id
         WHERE ${conditions.join(' AND ')} ORDER BY b.created_at DESC,b.id DESC ${paging}`,
        params,
    );
    return pageResult(rows);
};
const findInput = async (id) => {
    const row = await queryOne(
        `SELECT ${INPUT_DETAIL_COLUMNS},s.code scenario_code,s.version scenario_version
         FROM kttv.input_batches b LEFT JOIN hydro.scenarios s ON s.id=b.scenario_id WHERE b.id=$1`,
        [id],
    );
    if (!row) {
        return null;
    }
    const { rows } = await db.query(
        `SELECT variable,value,unit,quality_flag FROM kttv.observations
         WHERE input_batch_id=$1 ORDER BY variable`,
        [id],
    );
    return { ...row, observations: rows };
};
const ensureObservationPartition = async (client, observedAt) => {
    const date = new Date(observedAt);
    const year = date.getUTCFullYear();
    const month = date.getUTCMonth() + 1;
    const nextYear = month === 12 ? year + 1 : year;
    const nextMonth = month === 12 ? 1 : month + 1;
    const suffix = `${year}_${String(month).padStart(2, '0')}`;
    const from = `${year}-${String(month).padStart(2, '0')}-01T00:00:00Z`;
    const to = `${nextYear}-${String(nextMonth).padStart(2, '0')}-01T00:00:00Z`;
    // year/month chỉ sinh từ Date hợp lệ; suffix và literals không nhận từ người dùng.
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `kttv.observations_${suffix}`,
    ]);
    await client.query(
        `CREATE TABLE IF NOT EXISTS kttv.observations_${suffix}
         PARTITION OF kttv.observations FOR VALUES FROM ('${from}') TO ('${to}')`,
    );
};
const createInput = async (input) => {
    const client = await db.getClient();
    try {
        await client.query('BEGIN');
        await ensureObservationPartition(client, input.observedAt);
        const batch = await queryOne(
            `INSERT INTO kttv.input_batches AS b (input_mode,station_code,observed_at,values_snapshot,
                raw_payload,source_id,entered_by,match_status,scenario_id,candidate_scenario_ids)
             VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING ${INPUT_COLUMNS}`,
            [
                input.inputMode,
                input.stationCode,
                input.observedAt,
                JSON.stringify(input.values),
                JSON.stringify(input.rawPayload),
                input.sourceId || null,
                input.enteredBy || null,
                input.match.status,
                input.match.scenarioId,
                input.match.candidateScenarioIds,
            ],
            client,
        );
        for (const [variable, reading] of Object.entries(input.values)) {
            await client.query(
                `INSERT INTO kttv.observations(station_code,variable,observed_at,value,quality_flag,
                    source_id,unit,input_batch_id,input_mode,entered_by,raw_payload)
                 VALUES($1,$2,$3,$4,'valid',$5,$6,$7,$8,$9,$10)`,
                [
                    input.stationCode,
                    variable,
                    input.observedAt,
                    reading.value,
                    input.sourceId || null,
                    reading.unit,
                    batch.id,
                    input.inputMode,
                    input.enteredBy || null,
                    JSON.stringify(input.rawPayload),
                ],
            );
        }
        await client.query('COMMIT');
        return batch;
    } catch (error) {
        await client.query('ROLLBACK');
        if (error.code === '23505' && input.inputMode === 'automatic') {
            return queryOne(
                `SELECT ${INPUT_COLUMNS} FROM kttv.input_batches b
                 WHERE source_id=$1 AND station_code=$2 AND observed_at=$3`,
                [input.sourceId, input.stationCode, input.observedAt],
            );
        }
        throw error;
    } finally {
        client.release();
    }
};

module.exports = {
    listSources,
    findSource,
    createSource,
    updateSource,
    deleteSource,
    markCollectionSuccess,
    markCollectionFailure,
    listScheduledSources,
    listStations,
    findStation,
    createStation,
    updateStation,
    deleteStation,
    listScenarios,
    findScenario,
    createScenario,
    updateScenario,
    publishScenario,
    listMatchableScenarios,
    listInputs,
    findInput,
    createInput,
};
