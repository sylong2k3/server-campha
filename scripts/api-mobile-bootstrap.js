'use strict';
require('dotenv').config({ quiet: true });

const fs = require('fs');
const path = require('path');

const baseUrl = (process.env.API_BASE_URL || 'http://127.0.0.1:3018').replace(/\/$/, '');
const password = process.env.API_TEST_PASSWORD;
const prefix = (process.env.API_FIXTURE_PREFIX || 'MOBACC').toUpperCase();
const apiRoot = `${baseUrl}/api/v1`;
const manifestPath = path.resolve(
    process.env.API_FIXTURE_MANIFEST || path.join('docs', 'api', 'mobile-api-fixtures.json'),
);
const fixtureDir = path.resolve(
    process.env.API_FIXTURE_DIR || path.join('.runtime', 'acceptance-fixtures'),
);
const layerWorkbook = path.resolve(
    process.env.API_LAYER_FIXTURE || path.join('.runtime', 'xlsx-valid.xlsx'),
);
const accounts = Object.freeze({
    system_admin: 'admin@campha.gov.vn',
    ubnd_tp: 'ubnd@campha.gov.vn',
    so_tnmt: 'tnmt@campha.gov.vn',
    so_xd: 'xaydung@campha.gov.vn',
    citizen: 'citizen@campha.gov.vn',
});
const tokens = {};
const evidence = [];

const assert = (condition, message) => {
    if (!condition) {
        throw new Error(message);
    }
};
const items = (result) => result.body?.data?.items || [];
const record = (label, method, route, status) => {
    evidence.push({ label, method, route, status });
    console.log(`[${status}] ${label}`);
};
const request = async (route, options = {}) => {
    const headers = { accept: 'application/json', ...(options.headers || {}) };
    if (options.role) {
        assert(tokens[options.role]?.accessToken, `Thiếu access token cho ${options.role}`);
        headers.authorization = `Bearer ${tokens[options.role].accessToken}`;
    }
    let body = options.body;
    if (body !== undefined && !Buffer.isBuffer(body) && typeof body !== 'string') {
        headers['content-type'] = headers['content-type'] || 'application/json';
        body = JSON.stringify(body);
    }
    const response = await fetch(`${route.startsWith('http') ? '' : apiRoot}${route}`, {
        method: options.method || 'GET',
        headers,
        body,
        redirect: options.redirect || 'follow',
    });
    const text = await response.text();
    let parsed = null;
    if (text) {
        try {
            parsed = JSON.parse(text);
        } catch {
            parsed = text;
        }
    }
    const expected = options.expected || [200];
    if (!expected.includes(response.status)) {
        const safe = typeof parsed === 'string' ? parsed.slice(0, 300) : parsed;
        throw new Error(
            `${options.label || route}: HTTP ${response.status}; ${JSON.stringify(safe)?.slice(0, 600)}`,
        );
    }
    if (options.label) {
        record(options.label, options.method || 'GET', route, response.status);
    }
    return { response, body: parsed };
};
const optional = async (label, action, blocker) => {
    try {
        return { ok: true, value: await action() };
    } catch (error) {
        console.warn(`[CONDITIONAL] ${label}: ${error.message}`);
        return { ok: false, blocker: blocker || error.message };
    }
};
const iso = (value) => new Date(value).toISOString();
const findOne = async (route, role, predicate, label) => {
    const result = await request(route, { role, label });
    return items(result).find(predicate) || null;
};

const loginAll = async () => {
    assert(password, 'API_TEST_PASSWORD bắt buộc; không hardcode mật khẩu trong runner');
    for (const [role, email] of Object.entries(accounts)) {
        const result = await request('/auth/login', {
            method: 'POST',
            body: { email, password },
            expected: [200],
            label: `Đăng nhập ${role}`,
        });
        assert(
            result.body?.data?.accessToken && result.body?.data?.refreshToken,
            `Login ${role} thiếu token`,
        );
        assert(result.body.data.user?.role?.code === role, `Login ${role} trả role sai`);
        tokens[role] = {
            accessToken: result.body.data.accessToken,
            refreshToken: result.body.data.refreshToken,
        };
        await request('/auth/me', { role, label: `Read-back hồ sơ ${role}` });
    }
    const refreshed = await request('/auth/refresh', {
        method: 'POST',
        body: { refreshToken: tokens.citizen.refreshToken },
        expected: [200],
        label: 'Xoay refresh token citizen',
    });
    tokens.citizen = {
        accessToken: refreshed.body.data.accessToken,
        refreshToken: refreshed.body.data.refreshToken,
    };
};

const upload = async ({ role = 'so_tnmt', category, fileName, contentType, sourcePath }) => {
    assert(fs.existsSync(sourcePath), `Thiếu file fixture: ${sourcePath}`);
    const presign = await request('/storage/uploads/presign', {
        role,
        method: 'POST',
        body: { category, originalName: fileName, contentType, expireSeconds: 900 },
        expected: [201],
        label: `Presign ${fileName}`,
    });
    const id = Number(presign.body.data.id);
    await request(presign.body.data.uploadUrl, {
        method: 'PUT',
        body: fs.readFileSync(sourcePath),
        headers: { 'content-type': contentType },
        expected: [200],
        label: `PUT MinIO ${fileName}`,
    });
    const committed = await request(`/storage/uploads/${id}/commit`, {
        role,
        method: 'POST',
        expected: [200],
        label: `Commit và quét ${fileName}`,
    });
    assert(committed.body.data?.scan_status === 'clean', `${fileName} chưa clean`);
    await request(`/storage/objects/${id}/download-url?expireSeconds=60`, {
        role,
        label: `Read-back URL ${fileName}`,
    });
    return { id, ...committed.body.data };
};

const ensureNews = async () => {
    const title = `${prefix} Bản tin phục vụ phát triển mobile`;
    let news = await findOne(
        `/admin/cms/news?q=${encodeURIComponent(title)}&page=1&limit=20`,
        'ubnd_tp',
        (row) => row.title === title,
        'Tìm tin fixture',
    );
    if (!news) {
        news = (
            await request('/admin/cms/news', {
                role: 'ubnd_tp',
                method: 'POST',
                body: {
                    title,
                    summary: 'Dữ liệu nghiệm thu server được tạo hoàn toàn qua HTTP API.',
                    content:
                        'Bản tin fixture ổn định để mobile kiểm tra danh sách, chi tiết và bình luận.',
                    visibility: 'public',
                    status: 'published',
                },
                expected: [201],
                label: 'Tạo tin public',
            })
        ).body.data;
    }
    await request(`/cms/news/${news.id}`, { label: 'Read-back tin public' });
    const comments = await request(`/admin/cms/news/${news.id}/comments?page=1&limit=100`, {
        role: 'ubnd_tp',
        label: 'Tìm bình luận fixture',
    });
    const commentText = `${prefix} Bình luận nghiệm thu từ tài khoản citizen`;
    let comment = items(comments).find((row) => row.content === commentText);
    if (!comment) {
        comment = (
            await request(`/cms/news/${news.id}/comments`, {
                role: 'citizen',
                method: 'POST',
                body: { content: commentText },
                expected: [201],
                label: 'Tạo bình luận citizen',
            })
        ).body.data;
    }
    if (comment.status !== 'approved') {
        comment = (
            await request(`/admin/cms/news/comments/${comment.id}`, {
                role: 'ubnd_tp',
                method: 'PATCH',
                body: { status: 'approved' },
                label: 'Duyệt bình luận',
            })
        ).body.data;
    }
    await request(`/cms/news/${news.id}/comments?page=1&limit=100`, {
        label: 'Read-back bình luận public',
    });
    return { id: Number(news.id), title, commentId: Number(comment.id) };
};

const ensureDocuments = async () => {
    const docCode = `${prefix}-DOC-001`;
    let document = await findOne(
        `/admin/cms/documents?q=${encodeURIComponent(docCode)}&page=1&limit=100`,
        'so_tnmt',
        (row) => row.document_code === docCode,
        'Tìm văn bản fixture',
    );
    if (!document) {
        const file = await upload({
            category: 'documents',
            fileName: `${prefix.toLowerCase()}-mobile-document.pdf`,
            contentType: 'application/pdf',
            sourcePath: path.join(fixtureDir, 'campha-mobile-document.pdf'),
        });
        document = (
            await request('/admin/cms/documents', {
                role: 'so_tnmt',
                method: 'POST',
                body: {
                    title: `${prefix} Tài liệu tích hợp mobile`,
                    documentCode: docCode,
                    issuingAgency: 'Sở Tài nguyên và Môi trường Quảng Ninh',
                    issuedAt: '2026-08-08T00:00:00.000Z',
                    description: 'Fixture PDF sạch, upload và commit hoàn toàn qua API.',
                    visibility: 'public',
                    fileObjectId: file.id,
                },
                expected: [201],
                label: 'Tạo văn bản PDF',
            })
        ).body.data;
    }
    await request(`/cms/documents/${document.id}`, { label: 'Read-back văn bản public' });
    const mapTitle = `${prefix} Bản đồ PDF mobile`;
    let pdfMap = await findOne(
        `/admin/cms/pdf-maps?q=${encodeURIComponent(mapTitle)}&page=1&limit=100`,
        'so_tnmt',
        (row) => row.title === mapTitle,
        'Tìm PDF map fixture',
    );
    if (!pdfMap) {
        const file = await upload({
            category: 'documents',
            fileName: `${prefix.toLowerCase()}-mobile-map.pdf`,
            contentType: 'application/pdf',
            sourcePath: path.join(fixtureDir, 'campha-mobile-map.pdf'),
        });
        pdfMap = (
            await request('/admin/cms/pdf-maps', {
                role: 'so_tnmt',
                method: 'POST',
                body: {
                    title: mapTitle,
                    scaleLabel: '1:10.000',
                    mapYear: 2026,
                    preparingAgency: 'Sở Tài nguyên và Môi trường Quảng Ninh',
                    description: 'Bản đồ PDF fixture cho mobile.',
                    visibility: 'public',
                    fileObjectId: file.id,
                },
                expected: [201],
                label: 'Tạo bản đồ PDF',
            })
        ).body.data;
    }
    await request(`/cms/pdf-maps/${pdfMap.id}`, { label: 'Read-back PDF map public' });
    return {
        document: { id: Number(document.id), code: docCode },
        pdfMap: { id: Number(pdfMap.id), title: mapTitle },
    };
};

const ensureRaster = async () => {
    const sceneCode = `${prefix}-S2-20260808`;
    let image = await findOne(
        `/admin/remote-sensing/images?q=${encodeURIComponent(sceneCode)}&page=1&limit=100`,
        'so_tnmt',
        (row) => row.scene_code === sceneCode,
        'Tìm raster fixture',
    );
    if (!image) {
        const file = await upload({
            category: 'raster',
            fileName: `${prefix.toLowerCase()}-mobile-raster.tif`,
            contentType: 'image/tiff',
            sourcePath: path.join(fixtureDir, 'campha-mobile-raster.tif'),
        });
        image = (
            await request('/admin/remote-sensing/images', {
                role: 'so_tnmt',
                method: 'POST',
                body: {
                    sceneCode,
                    title: `${prefix} Sentinel-2 raster fixture`,
                    platform: 'sentinel-2',
                    thematicGroup: 'mobile-acceptance',
                    coverageKey: `${prefix.toLowerCase()}-cam-pha`,
                    acquiredAt: '2026-08-08T00:00:00.000Z',
                    productLevel: 'L2A',
                    resolutionM: 10,
                    cloudCoverPercent: 2,
                    description: 'GeoTIFF tối thiểu, dùng nghiệm thu API file/raster.',
                    fileObjectId: file.id,
                },
                expected: [201],
                label: 'Tạo metadata raster',
            })
        ).body.data;
    }
    await request(`/remote-sensing/images/${image.id}`, { label: 'Read-back raster public' });
    await request(`/remote-sensing/images/${image.id}/download-url?expireSeconds=60`, {
        role: 'citizen',
        label: 'Read-back URL raster',
    });
    return { id: Number(image.id), sceneCode };
};

const ensureFieldReport = async () => {
    const description = `${prefix} Phản ánh ngập cục bộ tại tuyến đường phục vụ nghiệm thu mobile`;
    let report = await findOne(
        '/field-reports/mine?page=1&limit=100',
        'citizen',
        (row) => row.description === description,
        'Tìm field report fixture',
    );
    if (!report) {
        const photo = await upload({
            role: 'citizen',
            category: 'field-photos',
            fileName: `${prefix.toLowerCase()}-field-report.png`,
            contentType: 'image/png',
            sourcePath: path.join(fixtureDir, 'campha-field-report.png'),
        });
        report = (
            await request('/field-reports', {
                role: 'citizen',
                method: 'POST',
                body: {
                    description,
                    longitude: 107.31,
                    latitude: 21.01,
                    measuredGeometry: {
                        type: 'LineString',
                        coordinates: [
                            [107.309, 21.009],
                            [107.311, 21.011],
                        ],
                    },
                    photoIds: [photo.id],
                },
                expected: [201],
                label: 'Tạo phản ánh kèm ảnh',
            })
        ).body.data;
    }
    if (!['approved', 'resolved'].includes(report.status)) {
        report = (
            await request(`/admin/field-reports/${report.id}/review`, {
                role: 'ubnd_tp',
                method: 'PATCH',
                body: {
                    status: 'approved',
                    reason: 'Dữ liệu fixture hợp lệ cho mobile.',
                    expectedUpdatedAt: iso(report.updated_at),
                },
                label: 'Duyệt phản ánh',
            })
        ).body.data;
    }
    await request('/field-reports/public?page=1&limit=100', { label: 'Read-back phản ánh public' });
    await request(
        '/field-reports/nearby?longitude=107.31&latitude=21.01&radiusMeters=500&from=2026-01-01T00%3A00%3A00Z&to=2027-01-01T00%3A00%3A00Z',
        { label: 'Read-back phản ánh nearby' },
    );
    const deviceToken = `${prefix.toLowerCase()}-${'device-token-'.repeat(4)}`;
    await optional(
        'Đăng ký push token',
        () =>
            request('/devices/push-token', {
                role: 'citizen',
                method: 'PUT',
                body: { token: deviceToken, platform: 'android' },
                label: 'Đăng ký push token',
            }),
        'DEVICE_TOKEN_ENCRYPTION_KEY chưa được cấu hình',
    );
    return { id: Number(report.id), referenceCode: report.reference_code, status: report.status };
};

const ensureDraft = async () => {
    const title = `${prefix} Vùng khảo sát mobile`;
    let draft = await findOne(
        '/mobile/drafts?page=1&limit=100',
        'citizen',
        (row) => row.title === title,
        'Tìm mobile draft fixture',
    );
    if (!draft) {
        draft = (
            await request('/mobile/drafts', {
                role: 'citizen',
                method: 'POST',
                body: {
                    title,
                    properties: { purpose: 'acceptance', owner: 'mobile-team' },
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
                expected: [201],
                label: 'Tạo mobile draft',
            })
        ).body.data;
    }
    await request(`/mobile/drafts/${draft.id}`, {
        role: 'citizen',
        label: 'Read-back mobile draft',
    });
    await request('/mobile/measure', {
        role: 'citizen',
        method: 'POST',
        body: {
            geometry: {
                type: 'LineString',
                coordinates: [
                    [107.3, 21.0],
                    [107.31, 21.01],
                ],
            },
        },
        label: 'Đo khoảng cách mobile',
    });
    const weather = await optional(
        'Weather mobile',
        () =>
            request('/mobile/weather/current?longitude=107.31&latitude=21.01', {
                role: 'citizen',
                label: 'Đọc weather mobile',
            }),
        'OpenWeather external unavailable',
    );
    return {
        draft: { id: Number(draft.id), title },
        weatherReady: weather.ok,
        weatherBlocker: weather.blocker || null,
    };
};

const ensureKttv = async () => {
    const stationCode = `${prefix}01`;
    let station = await findOne(
        `/admin/kttv/stations?q=${encodeURIComponent(stationCode)}&page=1&limit=100`,
        'so_tnmt',
        (row) => row.code === stationCode,
        'Tìm trạm KTTV fixture',
    );
    if (!station) {
        station = (
            await request('/admin/kttv/stations', {
                role: 'so_tnmt',
                method: 'POST',
                body: {
                    code: stationCode,
                    name: `${prefix} Trạm Cẩm Phả`,
                    stationType: 'mua',
                    longitude: 107.31,
                    latitude: 21.01,
                    elevationM: 12,
                    managingOrg: 'Sở Tài nguyên và Môi trường Quảng Ninh',
                    isUsedForBasin: true,
                },
                expected: [201],
                label: 'Tạo trạm KTTV',
            })
        ).body.data;
    }
    await request(`/admin/kttv/stations/${stationCode}`, {
        role: 'so_tnmt',
        label: 'Read-back trạm KTTV',
    });
    const scenarios = [
        {
            code: `${prefix}_RAIN_NORMAL`,
            name: `${prefix} Kịch bản mưa thông thường`,
            priority: 200,
            rule: { all: [{ variable: 'rainfall', unit: 'mm', op: 'lt', value: 20 }] },
        },
        {
            code: `${prefix}_RAIN_HEAVY`,
            name: `${prefix} Kịch bản mưa lớn`,
            priority: 100,
            rule: { all: [{ variable: 'rainfall', unit: 'mm', op: 'gte', value: 20 }] },
        },
    ];
    const scenarioOut = [];
    for (const definition of scenarios) {
        let scenario = await findOne(
            `/admin/kttv/scenarios?q=${encodeURIComponent(definition.code)}&page=1&limit=100`,
            'so_tnmt',
            (row) => row.code === definition.code && row.status === 'official',
            `Tìm ${definition.code}`,
        );
        if (!scenario) {
            const draft = (
                await request('/admin/kttv/scenarios', {
                    role: 'so_tnmt',
                    method: 'POST',
                    body: {
                        code: definition.code,
                        name: definition.name,
                        description: 'Kịch bản do đơn vị nghiệp vụ chuẩn bị ở Sprint 10.',
                        matchRule: definition.rule,
                        matchPriority: definition.priority,
                    },
                    expected: [201],
                    label: `Tạo nháp ${definition.code}`,
                })
            ).body.data;
            scenario = (
                await request(`/admin/kttv/scenarios/${draft.id}/publish`, {
                    role: 'so_tnmt',
                    method: 'POST',
                    body: { expectedUpdatedAt: iso(draft.updated_at), isEnabled: true },
                    label: `Ban hành ${definition.code}`,
                })
            ).body.data;
        }
        await request(`/admin/kttv/scenarios/${scenario.id}`, {
            role: 'so_tnmt',
            label: `Read-back ${definition.code}`,
        });
        scenarioOut.push({
            id: Number(scenario.id),
            code: definition.code,
            status: scenario.status,
        });
    }
    let manual = await findOne(
        `/admin/kttv/inputs?inputMode=manual&stationCode=${stationCode}&page=1&limit=100`,
        'so_tnmt',
        (row) => Number(row.values_snapshot?.rainfall?.value) === 35,
        'Tìm input KTTV thủ công',
    );
    if (!manual) {
        manual = (
            await request('/admin/kttv/inputs/manual', {
                role: 'so_tnmt',
                method: 'POST',
                body: {
                    stationCode,
                    observedAt: new Date().toISOString(),
                    values: { rainfall: { value: 35, unit: 'mm' } },
                },
                expected: [201],
                label: 'Tạo input KTTV thủ công',
            })
        ).body.data;
    }
    await request(`/admin/kttv/inputs/${manual.id}`, {
        role: 'so_tnmt',
        label: 'Read-back input thủ công',
    });
    const sourceName = `${prefix} Open-Meteo Weather API`;
    let source = await findOne(
        `/admin/kttv/sources?q=${encodeURIComponent(sourceName)}&page=1&limit=100`,
        'so_tnmt',
        (row) => row.name === sourceName,
        'Tìm nguồn Weather API',
    );
    if (!source) {
        source = (
            await request('/admin/kttv/sources', {
                role: 'so_tnmt',
                method: 'POST',
                body: {
                    name: sourceName,
                    provider: 'Open-Meteo',
                    serviceType: 'REST',
                    endpointUrl:
                        'https://api.open-meteo.com/v1/forecast?latitude=21.01&longitude=107.31&current=precipitation',
                    responseFormat: 'JSON',
                    licenseNote: 'Open-Meteo; fixture acceptance.',
                    variables: {
                        observedAtPath: 'current.time',
                        observedAtFormat: 'iso',
                        stationCode,
                        mappings: [
                            {
                                path: 'current.precipitation',
                                variable: 'rainfall',
                                unit: 'mm',
                                min: 0,
                                max: 1000,
                            },
                        ],
                    },
                    retryCount: 1,
                    retryDelaySec: 5,
                    isEnabled: true,
                },
                expected: [201],
                label: 'Tạo nguồn Open-Meteo',
            })
        ).body.data;
    }
    const automatic = await optional(
        'KTTV automatic collection',
        () =>
            request(`/admin/kttv/sources/${source.id}/collect`, {
                role: 'so_tnmt',
                method: 'POST',
                expected: [201],
                label: 'Thu thập Weather API tự động',
            }),
        'Open-Meteo/DNS external unavailable',
    );
    let automaticData = null;
    if (automatic.ok) {
        automaticData = automatic.value.body.data;
        await request(`/admin/kttv/inputs/${automaticData.id}`, {
            role: 'so_tnmt',
            label: 'Read-back input tự động',
        });
    }
    return {
        station: { code: stationCode, name: station.name },
        scenarios: scenarioOut,
        manualInput: {
            id: Number(manual.id),
            matchStatus: manual.match_status,
            scenarioId: Number(manual.scenario_id),
        },
        source: { id: Number(source.id), name: sourceName },
        automaticInput: automaticData
            ? {
                  id: Number(automaticData.id),
                  matchStatus: automaticData.match_status,
                  scenarioId: Number(automaticData.scenario_id),
              }
            : null,
        automaticBlocker: automatic.blocker || null,
    };
};

const ensureLayer = async () => {
    const code = `${prefix.toLowerCase()}_mobile_points`;
    let layer = await findOne(
        `/admin/layers?q=${encodeURIComponent(code)}&page=1&limit=100`,
        'so_tnmt',
        (row) => row.code === code,
        'Tìm layer fixture',
    );
    if (!layer) {
        const uploaded = await upload({
            category: 'layers',
            fileName: `${prefix.toLowerCase()}-mobile-points.xlsx`,
            contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            sourcePath: layerWorkbook,
        });
        const job = (
            await request('/admin/layers/imports/excel', {
                role: 'so_tnmt',
                method: 'POST',
                body: {
                    fileObjectId: uploaded.id,
                    code,
                    nameVi: `${prefix} Điểm mobile`,
                    category: 'mobile_acceptance',
                    targetSrid: 4326,
                    isPublic: true,
                    sheetName: 'points',
                    xColumn: 'x',
                    yColumn: 'y',
                    sourceSrid: 4326,
                },
                expected: [201],
                label: 'Xếp hàng import Excel',
            })
        ).body.data;
        const deadline = Date.now() + Number(process.env.API_IMPORT_TIMEOUT_MS || 120000);
        let state;
        do {
            await new Promise((resolve) => setTimeout(resolve, 1000));
            state = (
                await request(`/admin/layers/imports/${job.id}`, {
                    role: 'so_tnmt',
                    label: 'Poll import Excel',
                })
            ).body.data;
        } while (!['succeeded', 'failed'].includes(state.status) && Date.now() < deadline);
        assert(
            state.status === 'succeeded',
            `Import Excel ${state.status}: ${state.error_code || ''} ${state.error_message || ''}`,
        );
        layer = (
            await request(`/admin/layers/${state.layer_id}`, {
                role: 'so_tnmt',
                label: 'Read-back layer import',
            })
        ).body.data;
    }
    if (
        !Array.isArray(layer.metadata?.displayFields) ||
        !layer.metadata.displayFields.includes('name') ||
        !layer.is_public
    ) {
        layer = (
            await request(`/admin/layers/${layer.id}`, {
                role: 'so_tnmt',
                method: 'PATCH',
                body: {
                    expectedUpdatedAt: iso(layer.updated_at),
                    minZoom: 0,
                    maxZoom: 22,
                    isPublic: true,
                    metadata: {
                        ...layer.metadata,
                        idField: 'source_row',
                        displayFields: ['name', 'x', 'y'],
                        searchFields: ['name'],
                        editableFields: ['name'],
                    },
                },
                label: 'Cấu hình metadata layer',
            })
        ).body.data;
    }
    let publicationBlocker = null;
    if (layer.publish_status !== 'published') {
        const published = await optional(
            'GeoServer publish layer',
            () =>
                request(`/admin/layers/${layer.id}/publish`, {
                    role: 'so_tnmt',
                    method: 'POST',
                    label: 'Publish layer GeoServer',
                }),
            'GeoServer datastore chưa trỏ DB campha_mobile_acceptance',
        );
        if (published.ok) {
            layer = published.value.body.data;
        } else {
            publicationBlocker = published.blocker;
        }
    }
    if (layer.publish_status !== 'published') {
        publicationBlocker ||= 'Layer import đạt nhưng GeoServer publish chưa đạt';
    }
    if (layer.publish_status === 'published') {
        await request('/web-map/layers', { label: 'Read-back web-map catalog' });
        await request(`/mobile/layers/${layer.id}/features/2`, {
            role: 'citizen',
            label: 'Read-back mobile feature',
        });
        await request(
            `/mobile/layers/${layer.id}/nearby?longitude=107.3&latitude=21.0&radiusMeters=2000&limit=20`,
            { role: 'citizen', label: 'Read-back mobile nearby' },
        );
        await request(`/mobile/layers/${layer.id}/tiles/10/817/450.mvt`, {
            role: 'citizen',
            label: 'Read-back MVT',
        });
    }
    return {
        id: Number(layer.id),
        code,
        featureId: '2',
        publishStatus: layer.publish_status,
        tableName: layer.table_name,
        blocker: publicationBlocker,
    };
};

const ensureRegistry = async (layer) => {
    if (layer.publishStatus !== 'published') {
        return { ready: false, blocker: layer.blocker };
    }
    const slug = `${prefix.toLowerCase()}-mobile-points`;
    let registry = await findOne(
        `/admin/api-registry?q=${encodeURIComponent(slug)}&page=1&limit=20`,
        'so_tnmt',
        (row) => row.slug === slug,
        'Tìm API registry fixture',
    );
    if (!registry) {
        registry = (
            await request('/admin/api-registry', {
                role: 'so_tnmt',
                method: 'POST',
                body: {
                    layerId: layer.id,
                    slug,
                    name: `${prefix} Mobile points API`,
                    readFields: ['name', 'x', 'y'],
                    writeFields: [],
                    searchFields: ['name'],
                    allowedMethods: ['GET'],
                    defaultSortField: 'name',
                },
                expected: [201],
                label: 'Tạo API registry',
            })
        ).body.data;
    }
    await request(`/admin/api-registry/${registry.id}`, {
        role: 'so_tnmt',
        label: 'Read-back API registry',
    });
    const keyName = `${prefix} Mobile read key`;
    const existingKeys = await request(`/admin/api-registry/${registry.id}/keys`, {
        role: 'so_tnmt',
        label: 'Tìm API share key fixture',
    });
    const existingKey = (Array.isArray(existingKeys.body?.data) ? existingKeys.body.data : []).find(
        (row) => row.name === keyName && !row.revoked_at && new Date(row.expires_at) > new Date(),
    );
    const issued = existingKey
        ? { ok: true, value: { body: { data: existingKey } } }
        : await optional(
              'Issue API share key',
              () =>
                  request(`/admin/api-registry/${registry.id}/keys`, {
                      role: 'so_tnmt',
                      method: 'POST',
                      body: {
                          name: keyName,
                          consumer: 'Mobile development team',
                          scopes: ['features:read'],
                          quotaPerMinute: 60,
                          expiresInHours: 720,
                      },
                      expected: [201],
                      label: 'Cấp API share key',
                  }),
              'API_SHARE_JWT_SECRET chưa được cấu hình',
          );
    await request(`/admin/api-registry/${registry.id}/keys`, {
        role: 'so_tnmt',
        label: 'Read-back key metadata',
    });
    return {
        ready: true,
        id: Number(registry.id),
        slug,
        keyIssued: issued.ok,
        keyBlocker: issued.blocker || null,
    };
};

const verifyNegativeRbac = async () => {
    await request('/admin/layers?page=1&limit=10', {
        role: 'citizen',
        expected: [403],
        label: 'RBAC citizen bị chặn admin layers',
    });
    await request('/admin/kttv/stations', {
        role: 'citizen',
        method: 'POST',
        body: {
            code: `${prefix}XX`,
            name: 'Forbidden station',
            longitude: 107.3,
            latitude: 21,
        },
        expected: [403],
        label: 'RBAC citizen bị chặn tạo KTTV',
    });
    await request('/auth/me', { expected: [401], label: 'Anonymous bị chặn profile' });
};

const writeManifest = (fixtures) => {
    const moduleStatus = (ready, blocker = null) => ({
        status: ready ? 'ready' : 'conditional',
        ...(blocker ? { blocker } : {}),
    });
    const manifest = {
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        baseUrl,
        apiBaseUrl: apiRoot,
        prefix,
        database: 'campha_mobile_acceptance',
        fixturePolicy: 'business fixtures created and read back through HTTP API only',
        accounts: Object.entries(accounts).map(([role, email]) => ({ role, email })),
        fixtures,
        modules: {
            auth: moduleStatus(true),
            cms: moduleStatus(true),
            files: moduleStatus(Boolean(fixtures.content?.document && fixtures.fieldReport?.id)),
            raster: moduleStatus(Boolean(fixtures.raster?.id)),
            fieldReports: moduleStatus(Boolean(fixtures.fieldReport?.id)),
            mobileDraftMeasure: moduleStatus(Boolean(fixtures.mobile?.draft?.id)),
            mobileWeather: moduleStatus(
                fixtures.mobile?.weatherReady,
                fixtures.mobile?.weatherBlocker,
            ),
            kttvManual: moduleStatus(Boolean(fixtures.kttv?.manualInput?.id)),
            kttvAutomatic: moduleStatus(
                Boolean(fixtures.kttv?.automaticInput?.id),
                fixtures.kttv?.automaticBlocker,
            ),
            map: moduleStatus(
                fixtures.layer?.publishStatus === 'published',
                fixtures.layer?.blocker,
            ),
            apiRegistry: moduleStatus(fixtures.registry?.ready, fixtures.registry?.blocker),
            routingOfflineEdit: {
                status: 'deferred',
                blocker:
                    'Fixture Excel chỉ có Point; cần line/editable layer nghiệp vụ qua import API.',
            },
        },
        endpoints: {
            login: '/api/v1/auth/login',
            refresh: '/api/v1/auth/refresh',
            news: '/api/v1/cms/news',
            documents: '/api/v1/cms/documents',
            pdfMaps: '/api/v1/cms/pdf-maps',
            fieldReports: '/api/v1/field-reports/public',
            drafts: '/api/v1/mobile/drafts',
            measure: '/api/v1/mobile/measure',
            weather: '/api/v1/mobile/weather/current?longitude=107.31&latitude=21.01',
            mapCatalog: '/api/v1/web-map/layers',
            kttvStations: '/api/v1/admin/kttv/stations',
            kttvScenarios: '/api/v1/admin/kttv/scenarios',
            kttvInputs: '/api/v1/admin/kttv/inputs',
        },
        evidence: {
            requestCount: evidence.length,
            writes: evidence.filter((row) => !['GET', 'HEAD'].includes(row.method)).length,
            readBacks: evidence.filter((row) => row.label.includes('Read-back')).length,
        },
        secrets: 'No token, API key, password or credential stored.',
    };
    fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    console.log(`Manifest: ${manifestPath}`);
};

(async () => {
    const health = await request(`${baseUrl}/health`, { label: 'Health server' });
    assert(health.body?.status === 'OK', 'Health payload không OK');
    await loginAll();
    const fixtures = {};
    fixtures.news = await ensureNews();
    fixtures.content = await ensureDocuments();
    fixtures.raster = await ensureRaster();
    fixtures.fieldReport = await ensureFieldReport();
    fixtures.mobile = await ensureDraft();
    fixtures.kttv = await ensureKttv();
    const layer = await optional(
        'Import và publish layer',
        ensureLayer,
        'Upload/import worker/GDAL/GeoServer chưa sẵn sàng',
    );
    fixtures.layer = layer.ok
        ? layer.value
        : { publishStatus: 'unavailable', blocker: layer.blocker };
    fixtures.registry = await ensureRegistry(fixtures.layer);
    await verifyNegativeRbac();
    writeManifest(fixtures);
    console.log(`API bootstrap đạt: ${evidence.length} request có bằng chứng.`);
})().catch((error) => {
    console.error(`API bootstrap thất bại: ${error.message}`);
    process.exitCode = 1;
});
