'use strict';
require('dotenv').config({ quiet: true });

const fs = require('fs');
const path = require('path');

const manifestPath = path.resolve(
    process.env.API_FIXTURE_MANIFEST || path.join('docs', 'api', 'mobile-api-fixtures.json'),
);
const password = process.env.API_TEST_PASSWORD;
const manifestText = fs.readFileSync(manifestPath, 'utf8');
const manifest = JSON.parse(manifestText);
const baseUrl = (process.env.API_BASE_URL || manifest.baseUrl).replace(/\/$/, '');
const apiRoot = `${baseUrl}/api/v1`;
const tokens = {};
let checks = 0;

const assert = (condition, message) => {
    if (!condition) {
        throw new Error(message);
    }
};
const list = (body) => (Array.isArray(body?.data) ? body.data : body?.data?.items || []);
const includesId = (body, id) => list(body).some((row) => Number(row.id) === Number(id));
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

(async () => {
    assert(password, 'API_TEST_PASSWORD bắt buộc');
    assert(manifest.schemaVersion >= 2, 'Manifest chưa dùng schema fixture đầy đủ');
    assert(
        !/(accessToken|refreshToken|apiKey|password|uploadUrl|presignedUrl)\s*"\s*:/i.test(
            manifestText,
        ),
        'Manifest chứa secret field',
    );
    assert(manifest.accounts.length === 5, 'Manifest thiếu tài khoản vai trò');
    assert(
        manifest.evidence?.bootstrapStatus !== 'blocked',
        `Bootstrap chưa hoàn tất tại ${manifest.evidence?.blockerStage || 'unknown'}; xem modules conditional`,
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

    const news = manifest.fixtures.news;
    const firstNewsPage = await request(
        `/cms/news?q=${encodeURIComponent(news.searchTerm)}&page=1&limit=${news.pageSize}`,
        {
            label: 'Tin fixture trang 1',
            assert: (body) => {
                assert(Number(body.metadata?.total) >= news.total, 'Tổng tin fixture chưa đủ');
            },
        },
    );
    assert(list(firstNewsPage).length === news.pageSize, 'Trang 1 chưa đủ để test phân trang');
    const secondNewsPage = await request(
        `/cms/news?q=${encodeURIComponent(news.searchTerm)}&page=2&limit=${news.pageSize}`,
        {
            label: 'Tin fixture trang 2',
            assert: (body) => assert(list(body).length >= 2, 'Trang 2 thiếu dữ liệu'),
        },
    );
    const listedNewsIds = new Set(
        [...list(firstNewsPage), ...list(secondNewsPage)].map((row) => Number(row.id)),
    );
    for (const fixture of news.items) {
        assert(listedNewsIds.has(fixture.id), `Hai trang thiếu tin fixture ${fixture.id}`);
    }
    await request(`/cms/news/${news.primary.id}`, {
        label: 'Chi tiết tin fixture',
        assert: (body) => assert(body.data?.title === news.primary.title, 'Sai tin chính'),
    });
    await request(`/cms/news/${news.primary.id}/comments?page=1&limit=100`, {
        label: 'Chỉ bình luận đã duyệt public',
        assert: (body) => {
            assert(includesId(body, news.comments.approved), 'Thiếu bình luận approved');
            assert(!includesId(body, news.comments.pending), 'Lộ bình luận pending');
            assert(!includesId(body, news.comments.rejected), 'Lộ bình luận rejected');
        },
    });

    const content = manifest.fixtures.content;
    await request(`/cms/documents?q=${encodeURIComponent(content.searchTerm)}&page=1&limit=100`, {
        label: 'Guest chỉ thấy văn bản public',
        assert: (body) => {
            assert(includesId(body, content.publicDocument.id), 'Guest thiếu văn bản public');
            assert(!includesId(body, content.internalDocument.id), 'Guest thấy văn bản internal');
        },
    });
    for (const role of ['system_admin', 'ubnd_tp', 'so_tnmt', 'so_xd']) {
        await request(
            `/cms/documents?q=${encodeURIComponent(content.searchTerm)}&page=1&limit=100`,
            {
                role,
                label: `${role} thấy văn bản internal`,
                assert: (body) =>
                    assert(includesId(body, content.internalDocument.id), `${role} thiếu internal`),
            },
        );
    }
    await request(`/cms/documents/${content.publicDocument.id}/download-url?expireSeconds=60`, {
        role: 'so_tnmt',
        label: 'Tải văn bản thật',
        assert: (body) => assert(body.data?.url && body.data?.expiresAt, 'Thiếu download grant'),
    });
    for (const map of content.pdfMaps) {
        await request(`/cms/pdf-maps/${map.id}`, {
            label: `Bản đồ PDF ${map.year}`,
            assert: (body) => assert(Number(body.data?.map_year) === map.year, 'Sai năm PDF'),
        });
    }

    const fieldReports = manifest.fixtures.fieldReports;
    const mine = await request('/field-reports/mine?page=1&limit=100', {
        role: 'citizen',
        label: 'Phản ánh của citizen đủ trạng thái',
        assert: (body) => {
            for (const report of fieldReports.reports) {
                assert(includesId(body, report.id), `Mine thiếu ${report.status}`);
            }
        },
    });
    const mineRows = list(mine);
    assert(
        new Set(fieldReports.reports.map((row) => row.status)).size === 5,
        'Manifest phản ánh không đủ 5 trạng thái',
    );
    assert(fieldReports.reports.length === 6, 'Manifest phản ánh không phủ đủ số ảnh 0-5');
    assert(
        fieldReports.reports
            .map((row) => row.photoCount)
            .sort((left, right) => left - right)
            .join(',') === '0,1,2,3,4,5',
        'Manifest thiếu một mức photo count 0-5',
    );
    for (const report of fieldReports.reports) {
        assert(
            mineRows.some(
                (row) =>
                    Number(row.id) === report.id && Number(row.photo_count) === report.photoCount,
            ),
            `Sai photo_count ${report.status}`,
        );
        await request(`/field-reports/${report.id}`, {
            role: 'citizen',
            label: `Detail phản ánh ${report.status}`,
            assert: (body) => {
                assert(body.data?.status === report.status, `Sai status ${report.status}`);
                assert(body.data?.photos?.length === report.photoCount, `Sai ảnh ${report.status}`);
                assert(body.data?.history?.length >= 1, `Thiếu history ${report.status}`);
            },
        });
    }
    await request('/field-reports/public?page=1&limit=100', {
        label: 'Public chỉ approved và resolved',
        assert: (body) => {
            assert(includesId(body, fieldReports.byStatus.approved.id), 'Public thiếu approved');
            assert(includesId(body, fieldReports.byStatus.resolved.id), 'Public thiếu resolved');
            for (const status of ['pending', 'under_review', 'rejected']) {
                assert(!includesId(body, fieldReports.byStatus[status].id), `Public lộ ${status}`);
            }
        },
    });
    const center = fieldReports.nearbyCenter;
    await request(
        `/field-reports/nearby?longitude=${center.longitude}&latitude=${center.latitude}&radiusMeters=${center.radiusMeters}&from=2026-01-01T00%3A00%3A00Z&to=2026-12-31T23%3A59%3A59Z`,
        {
            label: 'Nearby phản ánh fixture',
            assert: (body) => {
                assert(
                    includesId(body, fieldReports.byStatus.approved.id),
                    'Nearby thiếu approved',
                );
                assert(
                    includesId(body, fieldReports.byStatus.resolved.id),
                    'Nearby thiếu resolved',
                );
            },
        },
    );

    const mobile = manifest.fixtures.mobile;
    const draftList = await request('/mobile/drafts?page=1&limit=100', {
        role: 'citizen',
        label: 'Danh sách ba draft',
    });
    for (const draft of mobile.drafts) {
        assert(includesId(draftList, draft.id), `Thiếu draft ${draft.geometryType}`);
        await request(`/mobile/drafts/${draft.id}`, {
            role: 'citizen',
            label: `Detail draft ${draft.geometryType}`,
            assert: (body) =>
                assert(
                    body.data?.geometry?.type === draft.geometryType,
                    `Sai geometry ${draft.geometryType}`,
                ),
        });
    }
    await request(`/mobile/drafts/${mobile.drafts[0].id}`, {
        role: 'so_tnmt',
        expected: [404],
        label: 'Draft owner isolation',
    });
    await request('/mobile/measure', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: {
            geometry: {
                type: 'LineString',
                coordinates: [
                    [107.31, 21.01],
                    [107.315, 21.015],
                ],
            },
        },
        label: 'Đo LineString',
        assert: (body) => assert(Number(body.data?.length_m) > 0, 'Chiều dài không hợp lệ'),
    });
    await request('/mobile/measure', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: {
            geometry: {
                type: 'Polygon',
                coordinates: [
                    [
                        [107.3, 21],
                        [107.31, 21],
                        [107.31, 21.01],
                        [107.3, 21],
                    ],
                ],
            },
        },
        label: 'Đo Polygon',
        assert: (body) => assert(Number(body.data?.area_m2) > 0, 'Diện tích không hợp lệ'),
    });
    if (manifest.modules.mobileWeather.status === 'ready') {
        await request('/mobile/weather/current?longitude=107.31&latitude=21.01', {
            label: 'Weather live',
            assert: (body) => assert(body.data?.observedAt, 'Weather thiếu thời điểm'),
        });
    }
    if (manifest.modules.routing.status === 'ready') {
        for (const profile of ['driving', 'walking', 'cycling']) {
            await request('/mobile/routes/shortest', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: { start: mobile.routing.start, end: mobile.routing.end, profile },
                label: `Routing ${profile}`,
                assert: (body) => {
                    assert(body.data?.provider === 'mapbox', 'Sai routing provider');
                    assert(body.data?.geometry?.type === 'LineString', 'Sai route geometry');
                    assert(body.data?.snapped_start?.type === 'Point', 'Thiếu snapped_start');
                    assert(body.data?.snapped_end?.type === 'Point', 'Thiếu snapped_end');
                },
            });
        }
    }

    const pointLayer = manifest.fixtures.layers.point;
    if (manifest.modules.map.status === 'ready') {
        await request('/web-map/layers', {
            label: 'Catalog có point layer',
            assert: (body) => assert(includesId(body, pointLayer.id), 'Catalog thiếu point layer'),
        });
        await request(`/mobile/layers/${pointLayer.id}/features/${pointLayer.featureId}`, {
            role: 'citizen',
            label: 'Point feature detail',
        });
        await request(
            `/mobile/layers/${pointLayer.id}/nearby?longitude=107.3&latitude=21&radiusMeters=2000&limit=20`,
            { role: 'citizen', label: 'Point layer nearby' },
        );
    }

    const editable = manifest.fixtures.layers.editable;
    if (manifest.modules.featureEditing.status === 'ready') {
        await request(`/mobile/layers/${editable.id}/features/${editable.featureId}`, {
            role: 'so_tnmt',
            label: 'Editable snapshot TNMT',
            assert: (body) =>
                assert(Number(body.data?.feature?.version) >= 2, 'Thiếu feature version'),
        });
        await request(`/mobile/layers/${editable.id}/features/${editable.featureId}/history`, {
            role: 'so_tnmt',
            label: 'Editable history TNMT',
            assert: (body) => assert(body.data?.length >= 2, 'History chưa đủ baseline/update'),
        });
        for (const role of ['citizen', 'system_admin', 'ubnd_tp', 'so_xd']) {
            await request(`/mobile/layers/${editable.id}/features/${editable.featureId}`, {
                role,
                method: 'PATCH',
                headers: { 'content-type': 'application/json' },
                body: { baseVersion: 1, attributes: { name: 'forbidden' } },
                expected: [403],
                label: `${role} không được sửa feature`,
            });
        }
        await request('/mobile/sync', {
            role: 'so_tnmt',
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: {
                clientId: editable.sync.clientId,
                changes: [
                    {
                        clientChangeId: editable.sync.applied,
                        layerId: editable.id,
                        featureId: editable.featureId,
                        baseVersion: editable.currentVersion - 1,
                        attributes: { name: `${manifest.prefix} Đồng bộ offline thành công` },
                    },
                ],
            },
            label: 'Sync receipt replay',
            assert: (body) =>
                assert(body.data?.applied?.[0]?.replayed === true, 'Sync chưa replay'),
        });
    }

    if (manifest.fixtures.raster?.id) {
        await request(`/remote-sensing/images/${manifest.fixtures.raster.id}`, {
            label: 'Raster metadata public',
        });
    }
    await request('/auth/me', { expected: [401], label: 'Anonymous auth/me bị chặn' });
    await request('/admin/layers?page=1&limit=10', {
        role: 'citizen',
        expected: [403],
        label: 'Citizen admin layers bị chặn',
    });

    console.log(`Acceptance verify đạt: ${checks} kiểm tra HTTP.`);
})().catch((error) => {
    console.error(`Acceptance verify thất bại: ${error.message}`);
    process.exitCode = 1;
});
