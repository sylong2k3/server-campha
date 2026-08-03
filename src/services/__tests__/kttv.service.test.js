'use strict';

jest.mock('../../repositories/kttv.repository');
jest.mock('../../utils/systemLogger.util', () => ({ logInfo: jest.fn() }));
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
        },
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
        },
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
        },
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
                        { name: 'x', serviceType: 'REST', endpointUrl: 'https://x' },
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

    test('không tìm thấy nguồn -> 404', async () => {
        repository.findSource.mockResolvedValue(null);
        await expect(service.testSourceConnection(999, admin)).rejects.toMatchObject({
            status: 404,
        });
        expect(fetchSafely).not.toHaveBeenCalled();
    });
});
