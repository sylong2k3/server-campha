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

        await expect(publishGeoTiffStream({ storeName: 'cp_moi', stream: stream(), contentLength: 1024 })).resolves.toBe(
            'campha:cp_moi',
        );

        const uploadCall = global.fetch.mock.calls.find(([url]) => url.includes('file.geotiff'));
        const [uploadUrl, uploadOptions] = uploadCall;
        expect(uploadUrl).toContain('configure=first');
        expect(uploadUrl).toContain('coverageName=cp_moi');
        expect(uploadOptions.headers).toMatchObject({
            'Content-Type': 'image/tiff',
            'Content-Length': '1024',
        });
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
            publishGeoTiffStream({
                storeName: 'cp_do_thi_2024',
                stream: stream(),
                contentLength: 2048,
            }),
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
            publishGeoTiffStream({ storeName: 'cp_loi', stream: stream(), contentLength: 1024 }),
        ).rejects.toThrow(/coverage already configured/);
    });

    test('từ chối kích thước không hợp lệ trước khi gọi GeoServer', async () => {
        global.fetch = jest.fn();

        await expect(
            publishGeoTiffStream({ storeName: 'cp_loi', stream: stream(), contentLength: 0 }),
        ).rejects.toThrow(/content length/);
        expect(global.fetch).not.toHaveBeenCalled();
    });
});
