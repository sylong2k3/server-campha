'use strict';

jest.mock('../../configs/geoserver', () => ({
    assertGeoserverConfigured: () => ({
        url: 'http://geoserver.test/geoserver',
        user: 'admin',
        password: 'secret',
        workspace: 'campha',
        datastore: 'campha_postgis',
        timeoutMs: 15000,
    }),
    validateResourceName: (value) => value,
}));

const { publishGeoTiffStream } = require('../geoserver.client');

const jsonResponse = (body, status = 200) => ({
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
    json: async () => body,
});

const stream = () => ({ pipe: jest.fn() });

describe('publishGeoTiffStream', () => {
    afterEach(() => {
        delete global.fetch;
    });

    test('dùng configure=first khi coverage store chưa tồn tại', async () => {
        global.fetch = jest.fn(async (url) => {
            if (url.endsWith('/coveragestores/cp_moi.json')) {
                return { ok: false, status: 404, text: async () => 'no such store' };
            }
            if (url.includes('file.geotiff')) {
                return jsonResponse({});
            }
            return jsonResponse({ layer: { name: 'cp_moi' } });
        });

        await expect(publishGeoTiffStream({ storeName: 'cp_moi', stream: stream() })).resolves.toBe(
            'campha:cp_moi',
        );

        const uploadUrl = global.fetch.mock.calls.map(([url]) => url).find((url) => url.includes('file.geotiff'));
        expect(uploadUrl).toContain('configure=first');
        expect(uploadUrl).toContain('coverageName=cp_moi');
    });

    test('dùng configure=none khi publish lại lên store đã có', async () => {
        global.fetch = jest.fn(async (url) => {
            if (url.endsWith('/coveragestores/cp_do_thi_2024.json')) {
                return jsonResponse({ coverageStore: { name: 'cp_do_thi_2024' } });
            }
            if (url.includes('file.geotiff')) {
                return jsonResponse({});
            }
            return jsonResponse({ layer: { name: 'cp_do_thi_2024' } });
        });

        await expect(
            publishGeoTiffStream({ storeName: 'cp_do_thi_2024', stream: stream() }),
        ).resolves.toBe('campha:cp_do_thi_2024');

        const uploadUrl = global.fetch.mock.calls.map(([url]) => url).find((url) => url.includes('file.geotiff'));
        expect(uploadUrl).toContain('configure=none');
        expect(uploadUrl).not.toContain('configure=first');
    });

    test('message lỗi kèm nội dung phản hồi GeoServer', async () => {
        global.fetch = jest.fn(async () => ({
            ok: false,
            status: 500,
            text: async () => 'java.lang.RuntimeException: coverage already configured',
        }));

        await expect(
            publishGeoTiffStream({ storeName: 'cp_loi', stream: stream() }),
        ).rejects.toThrow(/coverage already configured/);
    });
});
