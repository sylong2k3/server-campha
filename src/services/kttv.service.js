'use strict';

const repository = require('../repositories/kttv.repository');
const systemLogger = require('../utils/systemLogger.util');
const { fetchSafely } = require('../utils/ssrf-safe-fetch.util');
const {
    encryptCredential,
    decryptCredential,
    maskCredential,
} = require('../utils/kttv-credential.util');
const { Api403Error, Api404Error, Api409Error } = require('../core/error.response');

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

// Không bao giờ trả credential_enc thô; thay bằng cờ + 4 ký tự cuối.
const publicSourceRow = ({ credential_enc: credentialEnc, ...row }) => ({
    ...row,
    hasCredential: Boolean(credentialEnc),
    credentialLast4: credentialEnc ? maskCredential(credentialEnc).replace('****', '') : null,
});

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
    const row = await repository.createSource({ ...rest, credentialEnc });
    audit('kttv_source_created', actor, { sourceId: row.id, serviceType: row.service_type });
    return publicSourceRow(row);
};

const updateSource = async (id, input, actor) => {
    requirePermission(actor, 'create_source');
    guardDisplayConfig(actor, input);
    const { credential, ...patch } = input;
    if (credential !== undefined) {
        patch.credentialEnc = credential ? encryptCredential(JSON.stringify(credential)) : null;
    }
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

    const headers = {};
    if (source.credential_enc && source.auth_method) {
        const credential = JSON.parse(decryptCredential(source.credential_enc));
        if (source.auth_method === 'api_key' && credential.apiKey) {
            headers['X-API-Key'] = credential.apiKey;
        } else if (source.auth_method === 'bearer' && credential.token) {
            headers.Authorization = `Bearer ${credential.token}`;
        } else if (source.auth_method === 'basic' && credential.username) {
            headers.Authorization = `Basic ${Buffer.from(
                `${credential.username}:${credential.password || ''}`,
            ).toString('base64')}`;
        }
    }

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
};
