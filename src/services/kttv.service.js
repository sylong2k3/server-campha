'use strict';

const repository = require('../repositories/kttv.repository');
const systemLogger = require('../utils/systemLogger.util');
const { fetchSafely } = require('../utils/ssrf-safe-fetch.util');
const { matchScenarios } = require('../utils/kttv-matcher.util');
const {
    encryptCredential,
    decryptCredential,
    maskCredential,
} = require('../utils/kttv-credential.util');
const { Api403Error, Api404Error, Api409Error, Api422Error } = require('../core/error.response');

const has = (actor, action) => actor?.permissions?.kttv?.[action] === true;
const requirePermission = (actor, action) => {
    if (!has(actor, action)) {
        throw new Api403Error('Không có quyền thực hiện thao tác KTTV này');
    }
};
const audit = (action, actor, metadata) =>
    systemLogger.logInfo('kttv', action, {
        actorId: actor.id,
        role: actor.role,
        orgId: actor.orgId,
        ...metadata,
    });
const getOr404 = async (loader, message) => {
    const value = await loader();
    if (!value) {
        throw new Api404Error(message);
    }
    return value;
};
const changedOrError = async (value, exists, message) => {
    if (value) {
        return value;
    }
    if (!(await exists())) {
        throw new Api404Error(message);
    }
    throw new Api409Error('Dữ liệu đã thay đổi; vui lòng tải lại', ['OPTIMISTIC_LOCK_CONFLICT']);
};

// Chỉ TNMT được cấu hình hiển thị lớp (docs: "Chỉ TNMT — QT bị loại trừ").
const guardDisplayConfig = (actor, input) => {
    const provided = input.displayConfig && Object.keys(input.displayConfig).length > 0;
    if (provided && !has(actor, 'display_config')) {
        throw new Api403Error('Chỉ Sở TN&MT được cấu hình hiển thị lớp dữ liệu KTTV');
    }
};
const hasHydro = (actor, action) => actor?.permissions?.hydro?.[action] === true;
const requireHydroPermission = (actor, action) => {
    if (!hasHydro(actor, action)) {
        throw new Api403Error('Không có quyền thực hiện thao tác kịch bản này');
    }
};
const assertEffectiveRange = (effectiveFrom, effectiveTo) => {
    if (effectiveFrom && effectiveTo && new Date(effectiveFrom) >= new Date(effectiveTo)) {
        throw new Api422Error('Thời điểm bắt đầu hiệu lực phải trước thời điểm kết thúc', [
            'INVALID_EFFECTIVE_RANGE',
        ]);
    }
};
const authHeaders = (source) => {
    const headers = {};
    if (!source.credential_enc || !source.auth_method) {
        return headers;
    }
    let credential;
    try {
        credential = JSON.parse(decryptCredential(source.credential_enc));
    } catch {
        throw new Api422Error('Không thể đọc khóa truy cập của nguồn KTTV', [
            'SOURCE_CREDENTIAL_INVALID',
        ]);
    }
    if (source.auth_method === 'api_key' && credential.apiKey) {
        headers['X-API-Key'] = credential.apiKey;
    } else if (source.auth_method === 'bearer' && credential.token) {
        headers.Authorization = `Bearer ${credential.token}`;
    } else if (source.auth_method === 'basic' && credential.username) {
        headers.Authorization = `Basic ${Buffer.from(
            `${credential.username}:${credential.password || ''}`,
        ).toString('base64')}`;
    } else {
        throw new Api422Error('Khóa truy cập không khớp phương thức xác thực', [
            'SOURCE_CREDENTIAL_MISMATCH',
        ]);
    }
    return headers;
};
const assertCollectableSource = (source) => {
    const shouldCollect = Boolean(source.is_enabled || source.cron_expr);
    if (!shouldCollect) {
        return;
    }
    if (
        source.service_type !== 'REST' ||
        source.response_format !== 'JSON' ||
        !source.variables?.observedAtPath ||
        !source.variables?.stationCode ||
        !Array.isArray(source.variables?.mappings) ||
        source.variables.mappings.length === 0
    ) {
        throw new Api422Error('Nguồn bật hoặc lập lịch phải có cấu hình REST/JSON đầy đủ', [
            'SOURCE_NOT_COLLECTABLE',
        ]);
    }
};
const patchValue = (input, key, currentValue) =>
    Object.prototype.hasOwnProperty.call(input, key) ? input[key] : currentValue;
const sourceCandidate = (current, input, credentialEnc) => ({
    service_type: patchValue(input, 'serviceType', current?.service_type),
    response_format: patchValue(input, 'responseFormat', current?.response_format),
    variables: patchValue(input, 'variables', current?.variables),
    cron_expr: patchValue(input, 'cronExpr', current?.cron_expr) || null,
    is_enabled: patchValue(input, 'isEnabled', current?.is_enabled ?? false),
    auth_method: patchValue(input, 'authMethod', current?.auth_method) || null,
    credential_enc: credentialEnc !== undefined ? credentialEnc : (current?.credential_enc ?? null),
});
const assertSourceAuth = (source) => {
    if (Boolean(source.auth_method) !== Boolean(source.credential_enc)) {
        throw new Api422Error('Phương thức xác thực và khóa truy cập phải đi cùng nhau', [
            'SOURCE_AUTH_INCOMPLETE',
        ]);
    }
};

const publicSourceRow = ({ credential_enc: credentialEnc, ...row }) => {
    let credentialLast4 = null;
    if (credentialEnc) {
        try {
            credentialLast4 = maskCredential(credentialEnc).replace('****', '');
        } catch {
            throw new Api422Error('Không thể đọc khóa truy cập của nguồn KTTV', [
                'SOURCE_CREDENTIAL_INVALID',
            ]);
        }
    }
    return { ...row, hasCredential: Boolean(credentialEnc), credentialLast4 };
};

// ─── Sources ─────────────────────────────────────────────────────────────────

const listSources = async (filter, actor) => {
    requirePermission(actor, 'read');
    const result = await repository.listSources(filter);
    return { ...result, items: result.items.map(publicSourceRow) };
};

const getSource = async (id, actor) => {
    requirePermission(actor, 'read');
    const row = await getOr404(() => repository.findSource(id), 'Không tìm thấy nguồn KTTV');
    return publicSourceRow(row);
};

const createSource = async (input, actor) => {
    requirePermission(actor, 'create_source');
    guardDisplayConfig(actor, input);
    // Tách plaintext `credential` ra khỏi object truyền tiếp — không để nó "trôi"
    // xuống các tầng dưới (repository, log, error serialization) dù hiện tại
    // không tầng nào đọc field này; chỉ credentialEnc (đã mã hóa) mới đi tiếp.
    const { credential, ...rest } = input;
    const credentialEnc = credential ? encryptCredential(JSON.stringify(credential)) : null;
    const candidate = sourceCandidate(null, input, credentialEnc);
    assertSourceAuth(candidate);
    assertCollectableSource(candidate);
    const row = await repository.createSource({ ...rest, credentialEnc });
    audit('kttv_source_created', actor, { sourceId: row.id, serviceType: row.service_type });
    return publicSourceRow(row);
};

const updateSource = async (id, input, actor) => {
    requirePermission(actor, 'create_source');
    guardDisplayConfig(actor, input);
    const current = await getOr404(() => repository.findSource(id), 'Không tìm thấy nguồn KTTV');
    const { credential, ...patch } = input;
    if (credential !== undefined) {
        patch.credentialEnc = credential ? encryptCredential(JSON.stringify(credential)) : null;
    }
    const candidate = sourceCandidate(current, input, patch.credentialEnc);
    assertSourceAuth(candidate);
    assertCollectableSource(candidate);
    const row = await changedOrError(
        await repository.updateSource(id, patch),
        () => repository.findSource(id),
        'Không tìm thấy nguồn KTTV',
    );
    audit('kttv_source_updated', actor, { sourceId: id });
    return publicSourceRow(row);
};

const deleteSource = async (id, expectedUpdatedAt, actor) => {
    requirePermission(actor, 'create_source');
    const row = await changedOrError(
        await repository.deleteSource(id, expectedUpdatedAt),
        () => repository.findSource(id),
        'Không tìm thấy nguồn KTTV',
    );
    audit('kttv_source_deleted', actor, { sourceId: id });
    return row;
};

// US-10a.3: kiểm tra kết nối + xem trước dữ liệu — qua lớp chặn SSRF bắt buộc.
const testSourceConnection = async (id, actor) => {
    requirePermission(actor, 'test_source');
    const source = await getOr404(() => repository.findSource(id), 'Không tìm thấy nguồn KTTV');

    const headers = authHeaders(source);

    const startedAt = Date.now();
    try {
        const result = await fetchSafely(source.endpoint_url, { headers });
        const durationMs = Date.now() - startedAt;
        audit('kttv_source_test_connection', actor, {
            sourceId: id,
            status: result.status,
            durationMs,
            outcome: 'success',
        });
        return {
            status: result.status,
            durationMs,
            contentType: result.headers['content-type'] || null,
            previewBytes: Buffer.byteLength(result.body, 'utf8'),
            preview: result.body.slice(0, 2000),
        };
    } catch (error) {
        audit('kttv_source_test_connection', actor, {
            sourceId: id,
            outcome: 'failure',
            errorCode: error.errors?.[0],
            errorMessage: error.message,
        });
        throw error;
    }
};

// ─── Stations ────────────────────────────────────────────────────────────────

const listStations = async (filter, actor) => {
    requirePermission(actor, 'read');
    return repository.listStations(filter);
};

const getStation = async (code, actor) => {
    requirePermission(actor, 'read');
    return getOr404(() => repository.findStation(code), 'Không tìm thấy trạm quan trắc');
};

const createStation = async (input, actor) => {
    requirePermission(actor, 'manage_stations');
    const row = await repository.createStation(input);
    audit('kttv_station_created', actor, { stationCode: row.code });
    return row;
};

const updateStation = async (code, input, actor) => {
    requirePermission(actor, 'manage_stations');
    const row = await changedOrError(
        await repository.updateStation(code, input),
        () => repository.findStation(code),
        'Không tìm thấy trạm quan trắc',
    );
    audit('kttv_station_updated', actor, { stationCode: code });
    return row;
};

const deleteStation = async (code, expectedUpdatedAt, actor) => {
    requirePermission(actor, 'manage_stations');
    const row = await changedOrError(
        await repository.deleteStation(code, expectedUpdatedAt),
        () => repository.findStation(code),
        'Không tìm thấy trạm quan trắc',
    );
    audit('kttv_station_deleted', actor, { stationCode: code });
    return row;
};

// ─── Scenarios + two input modes ──────────────────────────────────────────────

const listScenarios = async (filter, actor) => {
    requireHydroPermission(actor, 'read');
    return repository.listScenarios(filter);
};
const getScenario = async (id, actor) => {
    requireHydroPermission(actor, 'read');
    return getOr404(() => repository.findScenario(id), 'Không tìm thấy kịch bản');
};
const createScenario = async (input, actor) => {
    requirePermission(actor, 'match_scenario');
    const row = await repository.createScenario(input, actor);
    audit('hydro_scenario_draft_created', actor, { scenarioId: row.id, code: row.code });
    return row;
};
const updateScenario = async (id, input, actor) => {
    requirePermission(actor, 'match_scenario');
    const current = await getOr404(() => repository.findScenario(id), 'Không tìm thấy kịch bản');
    if (current.status !== 'draft') {
        throw new Api409Error('Kịch bản đã ban hành là bất biến', ['SCENARIO_NOT_DRAFT']);
    }
    const effectiveFrom =
        input.effectiveFrom !== undefined ? input.effectiveFrom : current.effective_from;
    const effectiveTo = input.effectiveTo !== undefined ? input.effectiveTo : current.effective_to;
    assertEffectiveRange(effectiveFrom, effectiveTo);
    const row = await changedOrError(
        await repository.updateScenario(id, input),
        () => repository.findScenario(id),
        'Không tìm thấy kịch bản',
    );
    audit('hydro_scenario_draft_updated', actor, { scenarioId: id });
    return row;
};
const publishScenario = async (id, input, actor) => {
    requireHydroPermission(actor, 'publish_scenario');
    const row = await repository.publishScenario(
        id,
        input.expectedUpdatedAt,
        input.isEnabled,
        actor,
    );
    if (!row) {
        throw new Api404Error('Không tìm thấy kịch bản');
    }
    if (row.conflict === 'SCENARIO_NOT_FOUND') {
        throw new Api404Error('Không tìm thấy kịch bản');
    }
    if (row.conflict) {
        throw new Api409Error('Không thể ban hành kịch bản', [row.conflict]);
    }
    audit('hydro_scenario_published', actor, { scenarioId: id, isEnabled: row.is_enabled });
    return row;
};

const processInput = async (input) => {
    const scenarios = await repository.listMatchableScenarios(input.observedAt);
    const match = matchScenarios(scenarios, input.values, input.observedAt);
    return repository.createInput({ ...input, match });
};
const submitManualInput = async (input, actor) => {
    requirePermission(actor, 'manual_input');
    await getOr404(
        () => repository.findStation(input.stationCode),
        'Không tìm thấy trạm quan trắc',
    );
    const row = await processInput({
        inputMode: 'manual',
        stationCode: input.stationCode,
        observedAt: input.observedAt,
        values: input.values,
        rawPayload: input,
        enteredBy: actor.id,
    });
    audit('kttv_manual_input_created', actor, {
        inputId: row.id,
        matchStatus: row.match_status,
        scenarioId: row.scenario_id,
    });
    return row;
};
const readPath = (payload, path) =>
    path
        .split('.')
        .reduce(
            (value, key) => (value === null || value === undefined ? undefined : value[key]),
            payload,
        );
const parseObservedAt = (raw, format) => {
    let date;
    if (format === 'unix_seconds') {
        date = new Date(Number(raw) * 1000);
    } else if (format === 'unix_milliseconds') {
        date = new Date(Number(raw));
    } else {
        date = new Date(raw);
    }
    if (Number.isNaN(date.getTime())) {
        throw new Api422Error('Thời điểm từ Weather API không hợp lệ', ['INVALID_OBSERVED_AT']);
    }
    return date.toISOString();
};
const normalizeSourcePayload = (source, payload) => {
    const config = source.variables;
    if (!config?.observedAtPath || !config?.stationCode || !Array.isArray(config.mappings)) {
        throw new Api422Error('Nguồn chưa có cấu hình mapping biến hợp lệ', [
            'SOURCE_MAPPING_MISSING',
        ]);
    }
    const values = {};
    for (const mapping of config.mappings) {
        const sourceValue = readPath(payload, mapping.path);
        const raw =
            sourceValue === null || sourceValue === undefined || sourceValue === ''
                ? Number.NaN
                : Number(sourceValue);
        const value = raw * (mapping.factor ?? 1) + (mapping.offset ?? 0);
        if (
            !Number.isFinite(raw) ||
            !Number.isFinite(value) ||
            (mapping.min !== undefined && value < mapping.min) ||
            (mapping.max !== undefined && value > mapping.max)
        ) {
            throw new Api422Error(`Giá trị ${mapping.variable} không hợp lệ`, [
                'SOURCE_VALUE_INVALID',
            ]);
        }
        values[mapping.variable] = { value, unit: mapping.unit };
    }
    return {
        stationCode: config.stationCode,
        observedAt: parseObservedAt(
            readPath(payload, config.observedAtPath),
            config.observedAtFormat || 'iso',
        ),
        values,
    };
};
const collectSource = async (id, actor = null) => {
    if (actor) {
        requirePermission(actor, 'schedule');
    }
    const source = await getOr404(() => repository.findSource(id), 'Không tìm thấy nguồn KTTV');
    if (!source.is_enabled || source.service_type !== 'REST' || source.response_format !== 'JSON') {
        throw new Api422Error('Nguồn chưa bật hoặc chưa hỗ trợ thu thập tự động', [
            'SOURCE_NOT_COLLECTABLE',
        ]);
    }
    let response;
    try {
        response = await fetchSafely(source.endpoint_url, { headers: authHeaders(source) });
        if (response.status < 200 || response.status >= 300) {
            throw new Api422Error(`Weather API trả HTTP ${response.status}`, ['SOURCE_HTTP_ERROR']);
        }
        let payload;
        try {
            payload = JSON.parse(response.body);
        } catch {
            throw new Api422Error('Weather API không trả JSON hợp lệ', ['INVALID_SOURCE_JSON']);
        }
        const normalized = normalizeSourcePayload(source, payload);
        await getOr404(
            () => repository.findStation(normalized.stationCode),
            'Không tìm thấy trạm mapping của nguồn',
        );
        const row = await processInput({
            inputMode: 'automatic',
            ...normalized,
            rawPayload: payload,
            sourceId: source.id,
        });
        await repository.markCollectionSuccess(source.id, {
            httpStatus: response.status,
            responseBytes: Buffer.byteLength(response.body),
        });
        systemLogger.logInfo('kttv', 'kttv_automatic_input_created', {
            sourceId: source.id,
            inputId: row.id,
            matchStatus: row.match_status,
            scenarioId: row.scenario_id,
            actorId: actor?.id || null,
        });
        return row;
    } catch (error) {
        try {
            await repository.markCollectionFailure(source.id, {
                errorCode: error.errors?.[0] || error.code || 'SOURCE_COLLECTION_FAILED',
                httpStatus: response?.status || null,
                responseBytes: response?.body ? Buffer.byteLength(response.body) : null,
            });
        } catch (healthError) {
            systemLogger.logError('kttv', 'kttv_collection_health_update_failed', {
                sourceId: source.id,
                errorCode: healthError.code || null,
            });
        }
        throw error;
    }
};
const listInputs = async (filter, actor) => {
    requirePermission(actor, 'read');
    return repository.listInputs(filter);
};
const getInput = async (id, actor) => {
    requirePermission(actor, 'read');
    return getOr404(() => repository.findInput(id), 'Không tìm thấy dữ liệu đầu vào');
};

module.exports = {
    listSources,
    getSource,
    createSource,
    updateSource,
    deleteSource,
    testSourceConnection,
    listStations,
    getStation,
    createStation,
    updateStation,
    deleteStation,
    listScenarios,
    getScenario,
    createScenario,
    updateScenario,
    publishScenario,
    submitManualInput,
    normalizeSourcePayload,
    collectSource,
    listInputs,
    getInput,
};
