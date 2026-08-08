'use strict';

jest.mock('../../repositories/kttv.repository');
jest.mock('../../utils/systemLogger.util', () => ({ logInfo: jest.fn(), logError: jest.fn() }));
jest.mock('../../utils/ssrf-safe-fetch.util', () => ({ fetchSafely: jest.fn() }));
jest.mock('../../utils/kttv-credential.util', () => ({
    encryptCredential: jest.fn(),
    decryptCredential: jest.fn(),
    maskCredential: jest.fn(),
}));

const repository = require('../../repositories/kttv.repository');
const { fetchSafely } = require('../../utils/ssrf-safe-fetch.util');
const {
    encryptCredential,
    decryptCredential,
    maskCredential,
} = require('../../utils/kttv-credential.util');
const service = require('../kttv.service');

// Đúng theo docs/MA_TRAN_PHAN_QUYEN.csv — hàng "kttv".
const admin = {
    id: 1,
    role: 'system_admin',
    orgId: 1,
    permissions: {
        kttv: {
            read: true,
            create_source: true,
            test_source: true,
            manage_stations: true,
            schedule: true,
            manual_input: true,
            match_scenario: true,
        },
        hydro: { read: true },
    },
};
const tnmt = {
    id: 2,
    role: 'so_tnmt',
    orgId: 2,
    permissions: {
        kttv: {
            read: true,
            create_source: true,
            test_source: true,
            manage_stations: true,
            display_config: true,
            schedule: true,
            manual_input: true,
            match_scenario: true,
        },
        hydro: { read: true, publish_scenario: true },
    },
};
const soXd = {
    id: 3,
    role: 'so_xd',
    orgId: 3,
    permissions: {
        kttv: {
            read: true,
            create_source: true,
            test_source: true,
            manage_stations: true,
            schedule: true,
            manual_input: true,
            match_scenario: true,
        },
        hydro: { read: true },
    },
};
const ubndTp = {
    id: 4,
    role: 'ubnd_tp',
    orgId: 4,
    permissions: { kttv: { read: true, alarm_threshold: true } },
};
const citizen = { id: 5, role: 'citizen', orgId: 5, permissions: {} };

const rawSource = {
    id: 10,
    name: 'Open-Meteo',
    service_type: 'REST',
    endpoint_url: 'https://api.open-meteo.com/v1/forecast',
    auth_method: null,
    credential_enc: null,
    updated_at: new Date('2026-01-01'),
};

describe('kttv service — permission gating (theo MA_TRAN_PHAN_QUYEN.csv)', () => {
    beforeEach(() => jest.clearAllMocks());

    describe('read (list/get sources & stations)', () => {
        test.each([
            ['system_admin', admin, true],
            ['ubnd_tp', ubndTp, true],
            ['so_tnmt', tnmt, true],
            ['so_xd', soXd, true],
            ['citizen', citizen, false],
        ])('%s -> allowed=%s', async (_label, actor, allowed) => {
            repository.listSources.mockResolvedValue({ items: [], total: 0 });
            repository.listStations.mockResolvedValue({ items: [], total: 0 });
            if (allowed) {
                await expect(service.listSources({}, actor)).resolves.toMatchObject({ total: 0 });
                await expect(service.listStations({}, actor)).resolves.toMatchObject({ total: 0 });
            } else {
                await expect(service.listSources({}, actor)).rejects.toMatchObject({ status: 403 });
                await expect(service.listStations({}, actor)).rejects.toMatchObject({
                    status: 403,
                });
            }
        });
    });

    describe('create_source (CRUD nguồn)', () => {
        test.each([
            ['system_admin', admin, true],
            ['so_tnmt', tnmt, true],
            ['so_xd', soXd, true],
            ['ubnd_tp', ubndTp, false],
            ['citizen', citizen, false],
        ])('%s -> allowed=%s', async (_label, actor, allowed) => {
            repository.createSource.mockResolvedValue({ ...rawSource });
            if (allowed) {
                await expect(
                    service.createSource(
                        { name: 'x', serviceType: 'REST', endpointUrl: 'https://x' },
                        actor,
                    ),
                ).resolves.toMatchObject({ id: 10 });
            } else {
                await expect(
                    service.createSource(
                        {
                            name: 'x',
                            serviceType: 'REST',
                            endpointUrl: 'https://x',
                            responseFormat: 'JSON',
                            variables: {
                                observedAtPath: 'time',
                                stationCode: 'CP',
                                mappings: [{ path: 'rain', variable: 'rain_mm', unit: 'mm' }],
                            },
                        },
                        actor,
                    ),
                ).rejects.toMatchObject({ status: 403 });
            }
        });
    });

    describe('manage_stations (CRUD trạm)', () => {
        test.each([
            ['system_admin', admin, true],
            ['so_tnmt', tnmt, true],
            ['so_xd', soXd, true],
            ['ubnd_tp', ubndTp, false],
            ['citizen', citizen, false],
        ])('%s -> allowed=%s', async (_label, actor, allowed) => {
            repository.createStation.mockResolvedValue({ code: 'CP-01' });
            if (allowed) {
                await expect(
                    service.createStation(
                        { code: 'CP-01', name: 'x', longitude: 107, latitude: 21 },
                        actor,
                    ),
                ).resolves.toMatchObject({ code: 'CP-01' });
            } else {
                await expect(
                    service.createStation(
                        { code: 'CP-01', name: 'x', longitude: 107, latitude: 21 },
                        actor,
                    ),
                ).rejects.toMatchObject({ status: 403 });
            }
        });
    });

    describe('test_source (kiểm tra kết nối)', () => {
        test('citizen không có quyền test_source', async () => {
            repository.findSource.mockResolvedValue(rawSource);
            await expect(service.testSourceConnection(10, citizen)).rejects.toMatchObject({
                status: 403,
            });
            expect(fetchSafely).not.toHaveBeenCalled();
        });
    });

    describe('display_config — chỉ TNMT (docs: "Chỉ TNMT — QT bị loại trừ")', () => {
        test('system_admin (QT) bị chặn khi gửi displayConfig khác rỗng', async () => {
            await expect(
                service.createSource(
                    {
                        name: 'x',
                        serviceType: 'REST',
                        endpointUrl: 'https://x',
                        displayConfig: { colorScale: 'blue' },
                    },
                    admin,
                ),
            ).rejects.toMatchObject({ status: 403 });
            expect(repository.createSource).not.toHaveBeenCalled();
        });
        test('so_tnmt được phép gửi displayConfig', async () => {
            repository.createSource.mockResolvedValue({ ...rawSource });
            await expect(
                service.createSource(
                    {
                        name: 'x',
                        serviceType: 'REST',
                        endpointUrl: 'https://x',
                        displayConfig: { colorScale: 'blue' },
                    },
                    tnmt,
                ),
            ).resolves.toMatchObject({ id: 10 });
        });
        test('displayConfig rỗng/không gửi thì không bị chặn dù không phải TNMT', async () => {
            repository.createSource.mockResolvedValue({ ...rawSource });
            await expect(
                service.createSource(
                    { name: 'x', serviceType: 'REST', endpointUrl: 'https://x' },
                    admin,
                ),
            ).resolves.toMatchObject({ id: 10 });
            await expect(
                service.createSource(
                    { name: 'x', serviceType: 'REST', endpointUrl: 'https://x', displayConfig: {} },
                    admin,
                ),
            ).resolves.toMatchObject({ id: 10 });
        });
    });
});

describe('kttv service — không bao giờ lộ credential thô', () => {
    beforeEach(() => jest.clearAllMocks());

    test('list/get sources che credential_enc, chỉ trả hasCredential + 4 ký tự cuối', async () => {
        maskCredential.mockReturnValue('****1234');
        const withCred = { ...rawSource, credential_enc: Buffer.from('fake') };
        repository.listSources.mockResolvedValue({ items: [withCred], total: 1 });
        repository.findSource.mockResolvedValue(withCred);

        const list = await service.listSources({}, admin);
        expect(list.items[0]).not.toHaveProperty('credential_enc');
        expect(list.items[0]).toMatchObject({ hasCredential: true, credentialLast4: '1234' });

        const detail = await service.getSource(10, admin);
        expect(detail).not.toHaveProperty('credential_enc');
        expect(detail).toMatchObject({ hasCredential: true, credentialLast4: '1234' });
    });

    test('source không có credential -> hasCredential=false, credentialLast4=null', async () => {
        repository.findSource.mockResolvedValue({ ...rawSource, credential_enc: null });
        const detail = await service.getSource(10, admin);
        expect(detail).toMatchObject({ hasCredential: false, credentialLast4: null });
        expect(maskCredential).not.toHaveBeenCalled();
    });

    test('createSource mã hóa credential trước khi lưu, không lưu plaintext', async () => {
        encryptCredential.mockReturnValue(Buffer.from('encrypted'));
        repository.createSource.mockResolvedValue({
            ...rawSource,
            credential_enc: Buffer.from('encrypted'),
        });
        await service.createSource(
            {
                name: 'x',
                serviceType: 'REST',
                endpointUrl: 'https://x',
                authMethod: 'api_key',
                credential: { apiKey: 'plaintext-secret' },
            },
            admin,
        );
        expect(encryptCredential).toHaveBeenCalledWith(
            JSON.stringify({ apiKey: 'plaintext-secret' }),
        );
        const [callArg] = repository.createSource.mock.calls[0];
        expect(callArg.credentialEnc).toEqual(Buffer.from('encrypted'));
        expect(JSON.stringify(callArg)).not.toContain('plaintext-secret');
    });
});

describe('kttv service — optimistic lock (404 vs 409)', () => {
    beforeEach(() => jest.clearAllMocks());

    test('updateSource: 404 khi source không tồn tại', async () => {
        repository.updateSource.mockResolvedValue(null);
        repository.findSource.mockResolvedValue(null);
        await expect(
            service.updateSource(999, { name: 'y', expectedUpdatedAt: new Date() }, admin),
        ).rejects.toMatchObject({ status: 404 });
    });
    test('updateSource: 409 khi dữ liệu đã đổi (optimistic lock conflict)', async () => {
        repository.updateSource.mockResolvedValue(null);
        repository.findSource.mockResolvedValue(rawSource);
        await expect(
            service.updateSource(
                10,
                { name: 'y', expectedUpdatedAt: new Date('2020-01-01') },
                admin,
            ),
        ).rejects.toMatchObject({ status: 409, errors: ['OPTIMISTIC_LOCK_CONFLICT'] });
    });
    test('updateStation: 404 khi trạm không tồn tại', async () => {
        repository.updateStation.mockResolvedValue(null);
        repository.findStation.mockResolvedValue(null);
        await expect(
            service.updateStation('CP-XX', { name: 'y', expectedUpdatedAt: new Date() }, admin),
        ).rejects.toMatchObject({ status: 404 });
    });
});

describe('kttv service — testSourceConnection', () => {
    beforeEach(() => jest.clearAllMocks());

    test('gắn header X-API-Key khi auth_method=api_key', async () => {
        decryptCredential.mockReturnValue(JSON.stringify({ apiKey: 'secret-key' }));
        repository.findSource.mockResolvedValue({
            ...rawSource,
            auth_method: 'api_key',
            credential_enc: Buffer.from('x'),
        });
        fetchSafely.mockResolvedValue({
            status: 200,
            headers: { 'content-type': 'application/json' },
            body: '{}',
        });

        await service.testSourceConnection(10, admin);
        expect(fetchSafely).toHaveBeenCalledWith(
            rawSource.endpoint_url,
            expect.objectContaining({ headers: { 'X-API-Key': 'secret-key' } }),
        );
    });

    test('gắn header Authorization Bearer khi auth_method=bearer', async () => {
        decryptCredential.mockReturnValue(JSON.stringify({ token: 'tok123' }));
        repository.findSource.mockResolvedValue({
            ...rawSource,
            auth_method: 'bearer',
            credential_enc: Buffer.from('x'),
        });
        fetchSafely.mockResolvedValue({ status: 200, headers: {}, body: '{}' });

        await service.testSourceConnection(10, admin);
        expect(fetchSafely).toHaveBeenCalledWith(
            rawSource.endpoint_url,
            expect.objectContaining({ headers: { Authorization: 'Bearer tok123' } }),
        );
    });

    test('không có credential -> gọi fetchSafely không kèm header xác thực', async () => {
        repository.findSource.mockResolvedValue({
            ...rawSource,
            auth_method: null,
            credential_enc: null,
        });
        fetchSafely.mockResolvedValue({ status: 200, headers: {}, body: 'ok' });

        await service.testSourceConnection(10, admin);
        expect(fetchSafely).toHaveBeenCalledWith(rawSource.endpoint_url, { headers: {} });
        expect(decryptCredential).not.toHaveBeenCalled();
    });

    test('trả về preview đã cắt gọn + không lộ endpoint credential khi fetchSafely lỗi', async () => {
        repository.findSource.mockResolvedValue({
            ...rawSource,
            auth_method: null,
            credential_enc: null,
        });
        const sourceError = Object.assign(new Error('blocked'), {
            status: 422,
            errors: ['SSRF_BLOCKED_IP'],
        });
        fetchSafely.mockRejectedValue(sourceError);

        await expect(service.testSourceConnection(10, admin)).rejects.toMatchObject({
            status: 422,
            errors: ['SSRF_BLOCKED_IP'],
        });
    });

    test('khóa truy cập hỏng trả 422 thay vì 500 hoặc rò nội dung', async () => {
        decryptCredential.mockImplementation(() => {
            throw new Error('decrypt details must not escape');
        });
        repository.findSource.mockResolvedValue({
            ...rawSource,
            auth_method: 'bearer',
            credential_enc: Buffer.from('broken'),
        });

        await expect(service.testSourceConnection(10, admin)).rejects.toMatchObject({
            status: 422,
            errors: ['SOURCE_CREDENTIAL_INVALID'],
        });
        expect(fetchSafely).not.toHaveBeenCalled();
    });

    test('không tìm thấy nguồn -> 404', async () => {
        repository.findSource.mockResolvedValue(null);
        await expect(service.testSourceConnection(999, admin)).rejects.toMatchObject({
            status: 404,
        });
        expect(fetchSafely).not.toHaveBeenCalled();
    });
});

describe('kttv service — nguồn thu thập và publish scenario được chốt an toàn', () => {
    beforeEach(() => jest.clearAllMocks());

    test('không cho bật nguồn thiếu JSON mapping', async () => {
        repository.findSource.mockResolvedValue({
            ...rawSource,
            response_format: null,
            variables: {},
            is_enabled: false,
        });

        await expect(
            service.updateSource(
                10,
                { isEnabled: true, expectedUpdatedAt: new Date('2026-01-01') },
                admin,
            ),
        ).rejects.toMatchObject({ status: 422, errors: ['SOURCE_NOT_COLLECTABLE'] });
        expect(repository.updateSource).not.toHaveBeenCalled();
    });

    test('PATCH responseFormat=null trên nguồn đang bật bị chặn theo trạng thái sẽ lưu', async () => {
        repository.findSource.mockResolvedValue({
            ...rawSource,
            response_format: 'JSON',
            variables: {
                observedAtPath: 'time',
                stationCode: 'CP',
                mappings: [{ path: 'rain', variable: 'rain_1h_mm', unit: 'mm' }],
            },
            is_enabled: true,
        });

        await expect(
            service.updateSource(
                10,
                { responseFormat: null, expectedUpdatedAt: new Date('2026-01-01') },
                admin,
            ),
        ).rejects.toMatchObject({ status: 422, errors: ['SOURCE_NOT_COLLECTABLE'] });
        expect(repository.updateSource).not.toHaveBeenCalled();
    });

    test('PATCH authMethod=null không được để credential cũ mồ côi', async () => {
        repository.findSource.mockResolvedValue({
            ...rawSource,
            auth_method: 'bearer',
            credential_enc: Buffer.from('encrypted'),
        });

        await expect(
            service.updateSource(
                10,
                { authMethod: null, expectedUpdatedAt: new Date('2026-01-01') },
                admin,
            ),
        ).rejects.toMatchObject({ status: 422, errors: ['SOURCE_AUTH_INCOMPLETE'] });
        expect(repository.updateSource).not.toHaveBeenCalled();
    });

    test('partial PATCH effective date xung đột với draft hiện tại trả 422', async () => {
        repository.findScenario.mockResolvedValue({
            id: 7,
            status: 'draft',
            effective_from: new Date('2026-08-01T00:00:00Z'),
            effective_to: new Date('2026-08-31T00:00:00Z'),
        });
        await expect(
            service.updateScenario(
                7,
                {
                    effectiveFrom: new Date('2026-09-01T00:00:00Z'),
                    expectedUpdatedAt: new Date('2026-07-01T00:00:00Z'),
                },
                admin,
            ),
        ).rejects.toMatchObject({ status: 422, errors: ['INVALID_EFFECTIVE_RANGE'] });
        expect(repository.updateScenario).not.toHaveBeenCalled();
    });

    test('publish trả 404 khi repository xác nhận scenario không tồn tại', async () => {
        repository.publishScenario.mockResolvedValue({ conflict: 'SCENARIO_NOT_FOUND' });
        await expect(
            service.publishScenario(
                999,
                { expectedUpdatedAt: new Date('2026-01-01'), isEnabled: true },
                tnmt,
            ),
        ).rejects.toMatchObject({ status: 404 });
    });
});

describe('kttv service — hai chế độ dùng cùng normalize/matcher', () => {
    beforeEach(() => jest.clearAllMocks());

    const rule = {
        all: [{ variable: 'rain_1h_mm', unit: 'mm', op: 'gte', value: 30 }],
    };
    const matchable = {
        id: 77,
        match_priority: 10,
        match_rule: rule,
        effective_from: null,
        effective_to: null,
    };

    test('manual lưu enteredBy và chọn scenario tương ứng', async () => {
        repository.findStation.mockResolvedValue({ code: 'CP-WEATHER' });
        repository.listMatchableScenarios.mockResolvedValue([matchable]);
        repository.createInput.mockImplementation(async (input) => ({
            id: 1,
            input_mode: input.inputMode,
            entered_by: input.enteredBy,
            match_status: input.match.status,
            scenario_id: input.match.scenarioId,
        }));

        await expect(
            service.submitManualInput(
                {
                    stationCode: 'CP-WEATHER',
                    observedAt: '2026-08-07T09:00:00Z',
                    values: { rain_1h_mm: { value: 35, unit: 'mm' } },
                },
                tnmt,
            ),
        ).resolves.toMatchObject({
            input_mode: 'manual',
            entered_by: tnmt.id,
            match_status: 'matched',
            scenario_id: 77,
        });
        expect(repository.listMatchableScenarios).toHaveBeenCalledWith('2026-08-07T09:00:00Z');
    });

    test('automatic mapping tương đương chọn cùng scenario và lưu sourceId', async () => {
        const source = {
            ...rawSource,
            is_enabled: true,
            response_format: 'JSON',
            variables: {
                observedAtPath: 'current.time',
                observedAtFormat: 'iso',
                stationCode: 'CP-WEATHER',
                mappings: [
                    {
                        path: 'current.precipitation',
                        variable: 'rain_1h_mm',
                        unit: 'mm',
                        factor: 1,
                        offset: 0,
                        min: 0,
                        max: 500,
                    },
                ],
            },
        };
        repository.findSource.mockResolvedValue(source);
        repository.findStation.mockResolvedValue({ code: 'CP-WEATHER' });
        repository.listMatchableScenarios.mockResolvedValue([matchable]);
        repository.createInput.mockImplementation(async (input) => ({
            id: 2,
            input_mode: input.inputMode,
            source_id: input.sourceId,
            match_status: input.match.status,
            scenario_id: input.match.scenarioId,
        }));
        fetchSafely.mockResolvedValue({
            status: 200,
            body: JSON.stringify({
                current: { time: '2026-08-07T09:00:00Z', precipitation: 35 },
            }),
        });

        await expect(service.collectSource(10, admin)).resolves.toMatchObject({
            input_mode: 'automatic',
            source_id: 10,
            match_status: 'matched',
            scenario_id: 77,
        });
        expect(repository.listMatchableScenarios).toHaveBeenCalledWith('2026-08-07T09:00:00.000Z');
        expect(repository.markCollectionSuccess).toHaveBeenCalledWith(10, {
            httpStatus: 200,
            responseBytes: expect.any(Number),
        });
    });

    test('mapping null và HTTP lỗi bị chặn trước persistence', async () => {
        expect(() =>
            service.normalizeSourcePayload(
                {
                    variables: {
                        observedAtPath: 'time',
                        stationCode: 'CP',
                        mappings: [{ path: 'rain', variable: 'rain_1h_mm', unit: 'mm' }],
                    },
                },
                { time: '2026-08-07T09:00:00Z', rain: null },
            ),
        ).toThrow('Giá trị rain_1h_mm không hợp lệ');

        repository.findSource.mockResolvedValue({
            ...rawSource,
            is_enabled: true,
            response_format: 'JSON',
            variables: { observedAtPath: 'time', stationCode: 'CP', mappings: [] },
        });
        fetchSafely.mockResolvedValue({ status: 503, body: '{}' });
        await expect(service.collectSource(10, admin)).rejects.toMatchObject({
            status: 422,
            errors: ['SOURCE_HTTP_ERROR'],
        });
        expect(repository.createInput).not.toHaveBeenCalled();
        expect(repository.markCollectionFailure).toHaveBeenCalledWith(10, {
            errorCode: 'SOURCE_HTTP_ERROR',
            httpStatus: 503,
            responseBytes: 2,
        });
    });

    test('lỗi ghi collection health không che lỗi Weather API gốc', async () => {
        repository.findSource.mockResolvedValue({
            ...rawSource,
            is_enabled: true,
            response_format: 'JSON',
            variables: { observedAtPath: 'time', stationCode: 'CP', mappings: [] },
        });
        fetchSafely.mockResolvedValue({ status: 503, body: '{}' });
        repository.markCollectionFailure.mockRejectedValue(
            Object.assign(new Error('DB down'), { code: '08006' }),
        );

        await expect(service.collectSource(10, admin)).rejects.toMatchObject({
            status: 422,
            errors: ['SOURCE_HTTP_ERROR'],
        });
    });
});
