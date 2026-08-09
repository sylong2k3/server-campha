'use strict';
require('dotenv').config({ quiet: true });

const fs = require('fs');
const path = require('path');

const manifestPath = path.resolve(
    process.env.API_FIXTURE_MANIFEST || path.join('docs', 'api', 'mobile-api-fixtures.json'),
);
const password = process.env.API_TEST_PASSWORD;
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const baseUrl = (process.env.API_BASE_URL || manifest.baseUrl).replace(/\/$/, '');
const apiRoot = `${baseUrl}/api/v1`;
const tokens = {};
let checks = 0;

const assert = (condition, message) => {
    if (!condition) {
        throw new Error(message);
    }
};
const request = async (route, options = {}) => {
    const headers = { accept: 'application/json', ...(options.headers || {}) };
    if (options.role) {
        headers.authorization = `Bearer ${tokens[options.role].accessToken}`;
    }
    const response = await fetch(`${route.startsWith('http') ? '' : apiRoot}${route}`, {
        method: options.method || 'GET',
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    let body = null;
    if (options.binary) {
        body = await response.arrayBuffer();
    } else {
        const text = await response.text();
        if (text) {
            try {
                body = JSON.parse(text);
            } catch {
                body = text;
            }
        }
    }
    const expected = options.expected || [200];
    assert(expected.includes(response.status), `${options.label}: HTTP ${response.status}`);
    if (options.assert) {
        options.assert(body, response);
    }
    checks += 1;
    console.log(`[${response.status}] ${options.label}`);
    return body;
};
const login = async (role, email) => {
    const body = await request('/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: { email, password },
        label: `Login mới ${role}`,
        assert: (result) => assert(result.data?.user?.role?.code === role, `Role ${role} sai`),
    });
    tokens[role] = {
        accessToken: body.data.accessToken,
        refreshToken: body.data.refreshToken,
    };
};
const fixtureInList = (body, id) =>
    (Array.isArray(body.data) ? body.data : body.data?.items || []).some(
        (row) => Number(row.id) === Number(id),
    );

(async () => {
    assert(password, 'API_TEST_PASSWORD bắt buộc');
    assert(manifest.database === 'campha_mobile_acceptance', 'Manifest không thuộc acceptance DB');
    assert(
        !/(accessToken|refreshToken|apiKey|password)\s*"\s*:/i.test(JSON.stringify(manifest)),
        'Manifest chứa secret field',
    );
    for (const account of manifest.accounts) {
        await login(account.role, account.email);
    }

    await request('/auth/me', {
        role: 'citizen',
        label: 'Auth me citizen',
        assert: (body) => assert(body.data?.user?.email === 'citizen@campha.gov.vn', 'Sai citizen'),
    });
    const refreshed = await request('/auth/refresh', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: { refreshToken: tokens.citizen.refreshToken },
        label: 'Refresh token rotation',
        assert: (body) => assert(body.data?.refreshToken, 'Thiếu refresh token mới'),
    });
    tokens.citizen = {
        accessToken: refreshed.data.accessToken,
        refreshToken: refreshed.data.refreshToken,
    };

    await request(`/cms/news/${manifest.fixtures.news.id}`, {
        label: 'Tin public từ manifest',
        assert: (body) =>
            assert(body.data?.title === manifest.fixtures.news.title, 'Sai tin fixture'),
    });
    await request(`/cms/news/${manifest.fixtures.news.id}/comments?page=1&limit=100`, {
        label: 'Bình luận đã duyệt public',
        assert: (body) =>
            assert(
                fixtureInList(body, manifest.fixtures.news.commentId),
                'Không thấy comment fixture public',
            ),
    });
    await request(`/cms/documents/${manifest.fixtures.content.document.id}`, {
        label: 'Văn bản public',
    });
    await request(`/cms/pdf-maps/${manifest.fixtures.content.pdfMap.id}`, {
        label: 'PDF map public',
    });
    await request(`/remote-sensing/images/${manifest.fixtures.raster.id}`, {
        label: 'Raster metadata public',
    });

    await request('/field-reports/public?page=1&limit=100', {
        label: 'Field report public',
        assert: (body) =>
            assert(
                fixtureInList(body, manifest.fixtures.fieldReport.id),
                'Không thấy field report fixture',
            ),
    });
    await request(
        '/field-reports/nearby?longitude=107.31&latitude=21.01&radiusMeters=500&from=2026-01-01T00%3A00%3A00Z&to=2027-01-01T00%3A00%3A00Z',
        {
            label: 'Field report nearby',
            assert: (body) =>
                assert(
                    fixtureInList(body, manifest.fixtures.fieldReport.id),
                    'Nearby thiếu field report fixture',
                ),
        },
    );
    await request(`/mobile/drafts/${manifest.fixtures.mobile.draft.id}`, {
        role: 'citizen',
        label: 'Mobile draft detail',
        assert: (body) =>
            assert(body.data?.title === manifest.fixtures.mobile.draft.title, 'Sai draft fixture'),
    });
    await request('/mobile/measure', {
        role: 'citizen',
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: {
            geometry: {
                type: 'Polygon',
                coordinates: [
                    [
                        [107.3, 21.0],
                        [107.31, 21.0],
                        [107.31, 21.01],
                        [107.3, 21.0],
                    ],
                ],
            },
        },
        label: 'Mobile polygon measure',
        assert: (body) => assert(Number(body.data?.area_m2) > 0, 'Diện tích không hợp lệ'),
    });
    if (manifest.modules.mobileWeather.status === 'ready') {
        await request('/mobile/weather/current?longitude=107.31&latitude=21.01', {
            role: 'citizen',
            label: 'Mobile current weather',
        });
    }

    await request(`/admin/kttv/stations/${manifest.fixtures.kttv.station.code}`, {
        role: 'so_tnmt',
        label: 'KTTV station detail',
    });
    for (const scenario of manifest.fixtures.kttv.scenarios) {
        await request(`/admin/kttv/scenarios/${scenario.id}`, {
            role: 'so_tnmt',
            label: `KTTV scenario ${scenario.code}`,
            assert: (body) => assert(body.data?.status === 'official', 'Kịch bản chưa official'),
        });
    }
    await request(`/admin/kttv/inputs/${manifest.fixtures.kttv.manualInput.id}`, {
        role: 'so_tnmt',
        label: 'KTTV manual input matched',
        assert: (body) => {
            assert(body.data?.input_mode === 'manual', 'Sai input_mode manual');
            assert(body.data?.match_status === 'matched', 'Manual chưa matched');
        },
    });
    if (manifest.fixtures.kttv.automaticInput) {
        await request(`/admin/kttv/inputs/${manifest.fixtures.kttv.automaticInput.id}`, {
            role: 'so_tnmt',
            label: 'KTTV automatic input matched',
            assert: (body) => {
                assert(body.data?.input_mode === 'automatic', 'Sai input_mode automatic');
                assert(body.data?.match_status === 'matched', 'Automatic chưa matched');
            },
        });
    }

    await request('/auth/me', { expected: [401], label: 'RBAC anonymous auth/me' });
    await request('/admin/cms/news', {
        role: 'citizen',
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: {
            title: 'forbidden',
            content: 'forbidden',
            visibility: 'public',
            status: 'draft',
        },
        expected: [403],
        label: 'RBAC citizen create CMS bị chặn',
    });
    await request('/admin/kttv/sources', {
        role: 'citizen',
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: {
            name: 'forbidden',
            provider: 'forbidden',
            serviceType: 'REST',
            endpointUrl: 'https://api.open-meteo.com/v1/forecast',
            responseFormat: 'JSON',
            variables: {
                observedAtPath: 'current.time',
                observedAtFormat: 'iso',
                stationCode: 'FORBIDDEN',
                mappings: [
                    {
                        path: 'current.precipitation',
                        variable: 'rainfall',
                        unit: 'mm',
                    },
                ],
            },
        },
        expected: [403],
        label: 'RBAC citizen create KTTV bị chặn',
    });
    await request(`/admin/kttv/scenarios/${manifest.fixtures.kttv.scenarios[0].id}/publish`, {
        role: 'system_admin',
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: { expectedUpdatedAt: new Date().toISOString(), isEnabled: true },
        expected: [403],
        label: 'RBAC system_admin publish scenario bị chặn',
    });

    if (manifest.modules.map.status === 'ready') {
        const layer = manifest.fixtures.layer;
        await request('/web-map/layers', {
            label: 'Web map catalog',
            assert: (body) => assert(fixtureInList(body, layer.id), 'Catalog thiếu layer fixture'),
        });
        await request(`/mobile/layers/${layer.id}/features/${layer.featureId}`, {
            role: 'citizen',
            label: 'Mobile map feature detail',
        });
        await request(
            `/mobile/layers/${layer.id}/nearby?longitude=107.3&latitude=21.0&radiusMeters=2000&limit=20`,
            { role: 'citizen', label: 'Mobile map nearby' },
        );
        await request(`/mobile/layers/${layer.id}/tiles/10/817/450.mvt`, {
            role: 'citizen',
            binary: true,
            label: 'Mobile MVT non-empty',
            assert: (body, response) => {
                assert(
                    response.headers.get('content-type')?.includes('mapbox-vector-tile'),
                    'Sai MVT content-type',
                );
                assert(body.byteLength > 0, 'MVT fixture rỗng');
            },
        });
    }

    console.log(`Acceptance verify đạt: ${checks} kiểm tra HTTP.`);
})().catch((error) => {
    console.error(`Acceptance verify thất bại: ${error.message}`);
    process.exitCode = 1;
});
