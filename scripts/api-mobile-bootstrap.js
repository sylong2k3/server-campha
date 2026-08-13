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
const lineLayerArchive = path.resolve(
    process.env.API_LINE_LAYER_FIXTURE || path.join('.runtime', 'gap-network.zip'),
);
const databaseName = process.env.DB_NAME || 'unknown';
const accounts = Object.freeze({
    system_admin: 'admin@campha.gov.vn',
    ubnd_tp: 'ubnd@campha.gov.vn',
    so_tnmt: 'tnmt@campha.gov.vn',
    so_xd: 'xaydung@campha.gov.vn',
    citizen: 'citizen@campha.gov.vn',
});
const tokens = {};
const evidence = [];
const bootstrapFixtures = {};
let bootstrapStage = 'startup';

const assert = (condition, message) => {
    if (!condition) {
        throw new Error(message);
    }
};
const items = (result) => result.body?.data?.items || [];
const data = (result) => result.body?.data;
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
const safeBlocker = (message) => {
    const text = String(message || 'BOOTSTRAP_BLOCKED');
    if (text.includes('MALWARE_SCANNER_UNAVAILABLE')) {
        return 'MALWARE_SCANNER_UNAVAILABLE';
    }
    if (/Mapbox|ROUTING_UPSTREAM_UNAVAILABLE/i.test(text)) {
        return 'ROUTING_UPSTREAM_UNAVAILABLE';
    }
    if (/OpenWeather|WEATHER_/i.test(text)) {
        return 'WEATHER_UPSTREAM_UNAVAILABLE';
    }
    if (/GeoServer/i.test(text)) {
        return 'GEOSERVER_UNAVAILABLE';
    }
    return text.split(/\r?\n/, 1)[0].slice(0, 240);
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
const fixturePath = (name) => path.join(fixtureDir, name);
const ensureFixtureFiles = () => {
    fs.mkdirSync(fixtureDir, { recursive: true });
    const png = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
        'base64',
    );
    const pdf = Buffer.from(
        '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Count 0/Kids[]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n',
    );
    for (let index = 1; index <= 5; index += 1) {
        const file = fixturePath(`campha-field-report-${index}.png`);
        if (!fs.existsSync(file)) {
            fs.writeFileSync(file, png);
        }
    }
    for (const name of ['campha-mobile-document.pdf', 'campha-mobile-map.pdf']) {
        const file = fixturePath(name);
        if (!fs.existsSync(file)) {
            fs.writeFileSync(file, pdf);
        }
    }
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
            data(result)?.accessToken && data(result)?.refreshToken,
            `Login ${role} thiếu token`,
        );
        assert(data(result).user?.role?.code === role, `Login ${role} trả role sai`);
        tokens[role] = {
            accessToken: data(result).accessToken,
            refreshToken: data(result).refreshToken,
        };
        await request('/auth/me', { role, label: `Read-back hồ sơ ${role}` });
    }
    const refreshed = await request('/auth/refresh', {
        method: 'POST',
        body: { refreshToken: tokens.citizen.refreshToken },
        label: 'Xoay refresh token citizen',
    });
    tokens.citizen = {
        accessToken: data(refreshed).accessToken,
        refreshToken: data(refreshed).refreshToken,
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
    const id = Number(data(presign).id);
    await request(data(presign).uploadUrl, {
        method: 'PUT',
        body: fs.readFileSync(sourcePath),
        headers: { 'content-type': contentType },
        label: `PUT MinIO ${fileName}`,
    });
    const committed = await request(`/storage/uploads/${id}/commit`, {
        role,
        method: 'POST',
        label: `Commit và quét ${fileName}`,
    });
    assert(data(committed)?.scan_status === 'clean', `${fileName} chưa clean`);
    return { id, ...data(committed) };
};

const ensureNews = async () => {
    const definitions = Array.from({ length: 22 }, (_, index) => ({
        title: `${prefix} Tin kiểm thử mobile ${String(index + 1).padStart(2, '0')}`,
        summary: `${prefix} dữ liệu trang ${index < 20 ? 'đầu' : 'tiếp theo'} để thử tìm kiếm và phân trang.`,
        content: `Nội dung tin fixture số ${index + 1}. Từ khóa tìm kiếm ổn định: ${prefix}.`,
    }));
    const output = [];
    for (const definition of definitions) {
        let news = await findOne(
            `/admin/cms/news?q=${encodeURIComponent(definition.title)}&page=1&limit=20`,
            'ubnd_tp',
            (row) => row.title === definition.title,
            `Tìm ${definition.title}`,
        );
        if (!news) {
            news = data(
                await request('/admin/cms/news', {
                    role: 'ubnd_tp',
                    method: 'POST',
                    body: { ...definition, visibility: 'public', status: 'published' },
                    expected: [201],
                    label: `Tạo ${definition.title}`,
                }),
            );
        }
        output.push({ id: Number(news.id), title: definition.title });
    }
    const primary = output[0];
    const commentDefinitions = [
        { suffix: 'đã duyệt', target: 'approved' },
        { suffix: 'chờ duyệt', target: 'pending' },
        { suffix: 'đã từ chối', target: 'rejected' },
    ];
    const adminComments = await request(`/admin/cms/news/${primary.id}/comments?page=1&limit=100`, {
        role: 'ubnd_tp',
        label: 'Tìm bình luận fixture',
    });
    const comments = {};
    for (const definition of commentDefinitions) {
        const content = `${prefix} Bình luận ${definition.suffix} trên mobile`;
        let comment = items(adminComments).find((row) => row.content === content);
        if (!comment) {
            comment = data(
                await request(`/cms/news/${primary.id}/comments`, {
                    role: 'citizen',
                    method: 'POST',
                    body: { content },
                    expected: [201],
                    label: `Tạo bình luận ${definition.suffix}`,
                }),
            );
        }
        if (definition.target !== 'pending' && comment.status !== definition.target) {
            comment = data(
                await request(`/admin/cms/news/comments/${comment.id}`, {
                    role: 'ubnd_tp',
                    method: 'PATCH',
                    body: { status: definition.target },
                    label: `Chuyển bình luận sang ${definition.target}`,
                }),
            );
        }
        comments[definition.target] = Number(comment.id);
    }
    await request(`/cms/news?q=${prefix}&page=1&limit=20`, {
        label: 'Read-back tìm kiếm tin trang 1',
    });
    await request(`/cms/news?q=${prefix}&page=2&limit=20`, {
        label: 'Read-back phân trang tin trang 2',
    });
    await request(`/cms/news/${primary.id}/comments?page=1&limit=100`, {
        label: 'Read-back bình luận public',
    });
    return {
        searchTerm: prefix,
        primary,
        total: output.length,
        pageSize: 20,
        items: output,
        comments,
    };
};

const ensureDocuments = async () => {
    const documents = [];
    const definitions = [
        {
            code: `${prefix}-DOC-PUBLIC`,
            title: `${prefix} Văn bản công khai`,
            visibility: 'public',
        },
        {
            code: `${prefix}-DOC-INTERNAL`,
            title: `${prefix} Văn bản nội bộ`,
            visibility: 'internal',
        },
    ];
    for (const definition of definitions) {
        let document = await findOne(
            `/admin/cms/documents?q=${encodeURIComponent(definition.code)}&page=1&limit=100`,
            'so_tnmt',
            (row) => row.document_code === definition.code,
            `Tìm ${definition.code}`,
        );
        if (!document) {
            const file = await upload({
                category: 'documents',
                fileName: `${definition.code.toLowerCase()}.pdf`,
                contentType: 'application/pdf',
                sourcePath: fixturePath('campha-mobile-document.pdf'),
            });
            document = data(
                await request('/admin/cms/documents', {
                    role: 'so_tnmt',
                    method: 'POST',
                    body: {
                        title: definition.title,
                        documentCode: definition.code,
                        issuingAgency: 'Sở Tài nguyên và Môi trường Quảng Ninh',
                        issuedAt: '2026-08-08T00:00:00.000Z',
                        description: `${prefix} fixture kiểm tra tải PDF và phân quyền.`,
                        visibility: definition.visibility,
                        fileObjectId: file.id,
                    },
                    expected: [201],
                    label: `Tạo ${definition.title}`,
                }),
            );
        }
        documents.push({
            id: Number(document.id),
            code: definition.code,
            title: definition.title,
            visibility: definition.visibility,
        });
    }
    const pdfMaps = [];
    for (const [index, year] of [2024, 2025, 2026].entries()) {
        const title = `${prefix} Bản đồ PDF Cẩm Phả ${year}`;
        let map = await findOne(
            `/admin/cms/pdf-maps?q=${encodeURIComponent(title)}&page=1&limit=100`,
            'so_tnmt',
            (row) => row.title === title,
            `Tìm bản đồ PDF ${year}`,
        );
        if (!map) {
            const file = await upload({
                category: 'documents',
                fileName: `${prefix.toLowerCase()}-map-${year}.pdf`,
                contentType: 'application/pdf',
                sourcePath: fixturePath('campha-mobile-map.pdf'),
            });
            map = data(
                await request('/admin/cms/pdf-maps', {
                    role: 'so_tnmt',
                    method: 'POST',
                    body: {
                        title,
                        scaleLabel: ['1:5.000', '1:10.000', '1:25.000'][index],
                        mapYear: year,
                        preparingAgency: 'Sở Tài nguyên và Môi trường Quảng Ninh',
                        description: `${prefix} bản đồ PDF kiểm thử mobile.`,
                        visibility: 'public',
                        fileObjectId: file.id,
                    },
                    expected: [201],
                    label: `Tạo bản đồ PDF ${year}`,
                }),
            );
        }
        pdfMaps.push({ id: Number(map.id), title, year });
    }
    const publicDocument = documents.find((row) => row.visibility === 'public');
    const internalDocument = documents.find((row) => row.visibility === 'internal');
    await request(`/cms/documents?q=${prefix}&page=1&limit=20`, {
        label: 'Read-back văn bản khách',
    });
    await request(`/cms/documents?q=${prefix}&page=1&limit=20`, {
        role: 'so_tnmt',
        label: 'Read-back văn bản nội bộ TNMT',
    });
    await request(`/cms/documents/${publicDocument.id}/download-url?expireSeconds=60`, {
        role: 'so_tnmt',
        label: 'Read-back URL văn bản',
    });
    await request(`/cms/pdf-maps/${pdfMaps[0].id}/download-url?expireSeconds=60`, {
        role: 'citizen',
        label: 'Read-back URL PDF map',
    });
    return { searchTerm: prefix, documents, publicDocument, internalDocument, pdfMaps };
};

const REPORT_DEFINITIONS = [
    {
        key: 'pending',
        status: 'pending',
        photos: 0,
        longitude: 107.31,
        latitude: 21.01,
        geometry: { type: 'Point', coordinates: [107.31, 21.01] },
        label: 'ổ gà đang chờ tiếp nhận',
    },
    {
        key: 'under_review',
        status: 'under_review',
        photos: 1,
        longitude: 107.3103,
        latitude: 21.0102,
        geometry: {
            type: 'LineString',
            coordinates: [
                [107.31, 21.01],
                [107.311, 21.011],
            ],
        },
        label: 'ngập cục bộ đang xem xét',
    },
    {
        key: 'approved',
        status: 'approved',
        photos: 3,
        longitude: 107.3105,
        latitude: 21.0104,
        geometry: {
            type: 'Polygon',
            coordinates: [
                [
                    [107.31, 21.01],
                    [107.311, 21.01],
                    [107.311, 21.011],
                    [107.31, 21.01],
                ],
            ],
        },
        label: 'rác thải đã xác minh',
    },
    {
        key: 'rejected',
        status: 'rejected',
        photos: 2,
        longitude: 107.325,
        latitude: 21.02,
        geometry: null,
        label: 'phản ánh trùng đã từ chối',
    },
    {
        key: 'approved_four_photos',
        status: 'approved',
        photos: 4,
        longitude: 107.3107,
        latitude: 21.0105,
        geometry: null,
        label: 'vỉa hè hư hỏng đã xác minh',
    },
    {
        key: 'resolved',
        status: 'resolved',
        photos: 5,
        longitude: 107.31,
        latitude: 21.0106,
        geometry: {
            type: 'LineString',
            coordinates: [
                [107.3098, 21.0104],
                [107.3108, 21.0112],
            ],
        },
        label: 'nắp cống đã xử lý',
    },
];
const transitionReport = async (report, status, reason) =>
    data(
        await request(`/admin/field-reports/${report.id}/review`, {
            role: 'ubnd_tp',
            method: 'PATCH',
            body: { status, reason, expectedUpdatedAt: iso(report.updated_at) },
            label: `Chuyển phản ánh ${report.id} sang ${status}`,
        }),
    );
const ensureReportStatus = async (report, target) => {
    if (report.status === target) {
        return report;
    }
    if (target === 'under_review') {
        return transitionReport(report, target, 'Đang xác minh hiện trường.');
    }
    if (target === 'approved') {
        if (report.status === 'pending' || report.status === 'under_review') {
            return transitionReport(report, target, 'Nội dung đã được xác minh.');
        }
    }
    if (target === 'rejected') {
        if (report.status === 'pending' || report.status === 'under_review') {
            return transitionReport(report, target, 'Phản ánh trùng với hồ sơ đã tiếp nhận.');
        }
    }
    if (target === 'resolved') {
        let current = report;
        if (current.status === 'pending' || current.status === 'under_review') {
            current = await transitionReport(current, 'approved', 'Nội dung đã được xác minh.');
        }
        if (current.status === 'approved') {
            current = await transitionReport(
                current,
                'resolved',
                'Đơn vị phụ trách đã hoàn tất xử lý.',
            );
        }
        return current;
    }
    throw new Error(`Không thể chuyển fixture ${report.status} -> ${target}`);
};
const ensureFieldReports = async () => {
    const mine = await request('/field-reports/mine?page=1&limit=100', {
        role: 'citizen',
        label: 'Tìm phản ánh fixture',
    });
    const output = [];
    for (const definition of REPORT_DEFINITIONS) {
        const description = `${prefix} ${definition.label} để kiểm thử mobile`;
        let report = items(mine).find((row) => row.description === description);
        if (!report) {
            const photoIds = [];
            for (let index = 1; index <= definition.photos; index += 1) {
                const photo = await upload({
                    role: 'citizen',
                    category: 'field-photos',
                    fileName: `${prefix.toLowerCase()}-${definition.key}-${index}.png`,
                    contentType: 'image/png',
                    sourcePath: fixturePath(`campha-field-report-${index}.png`),
                });
                photoIds.push(photo.id);
            }
            report = data(
                await request('/field-reports', {
                    role: 'citizen',
                    method: 'POST',
                    body: {
                        description,
                        longitude: definition.longitude,
                        latitude: definition.latitude,
                        ...(definition.geometry ? { measuredGeometry: definition.geometry } : {}),
                        photoIds,
                    },
                    expected: [201],
                    label: `Tạo phản ánh ${definition.key}`,
                }),
            );
        }
        report = await ensureReportStatus(report, definition.status);
        const detail = await request(`/field-reports/${report.id}`, {
            role: 'citizen',
            label: `Read-back chi tiết phản ánh ${definition.key}`,
        });
        assert(data(detail).photos.length === definition.photos, `Sai số ảnh ${definition.key}`);
        output.push({
            key: definition.key,
            id: Number(report.id),
            referenceCode: report.reference_code,
            status: report.status,
            photoCount: definition.photos,
            longitude: definition.longitude,
            latitude: definition.latitude,
            description,
        });
    }
    await request('/field-reports/public?page=1&limit=100', {
        label: 'Read-back phản ánh public',
    });
    await request(
        '/field-reports/nearby?longitude=107.31&latitude=21.01&radiusMeters=500&from=2026-01-01T00%3A00%3A00Z&to=2026-12-31T23%3A59%3A59Z',
        { label: 'Read-back phản ánh nearby' },
    );
    const push = await optional(
        'Đăng ký push token',
        () =>
            request('/devices/push-token', {
                role: 'citizen',
                method: 'PUT',
                body: {
                    token: `${prefix.toLowerCase()}-${'device-token-'.repeat(4)}`,
                    platform: 'android',
                },
                label: 'Đăng ký push token',
            }),
        'DEVICE_TOKEN_ENCRYPTION_KEY chưa được cấu hình',
    );
    return {
        nearbyCenter: { longitude: 107.31, latitude: 21.01, radiusMeters: 500 },
        reports: output,
        byStatus: Object.fromEntries(
            output.filter((row) => row.key === row.status).map((row) => [row.status, row]),
        ),
        pushReady: push.ok,
        pushBlocker: push.blocker || null,
    };
};

const DRAFT_DEFINITIONS = [
    {
        type: 'Point',
        title: `${prefix} Điểm khảo sát mobile`,
        geometry: { type: 'Point', coordinates: [107.31, 21.01] },
    },
    {
        type: 'LineString',
        title: `${prefix} Tuyến khảo sát mobile`,
        geometry: {
            type: 'LineString',
            coordinates: [
                [107.31, 21.01],
                [107.315, 21.015],
            ],
        },
    },
    {
        type: 'Polygon',
        title: `${prefix} Vùng khảo sát mobile`,
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
];
const ensureMobileTools = async () => {
    const current = await request('/mobile/drafts?page=1&limit=100', {
        role: 'citizen',
        label: 'Tìm mobile draft fixture',
    });
    const drafts = [];
    for (const definition of DRAFT_DEFINITIONS) {
        let draft = items(current).find((row) => row.title === definition.title);
        if (!draft) {
            draft = data(
                await request('/mobile/drafts', {
                    role: 'citizen',
                    method: 'POST',
                    body: {
                        title: definition.title,
                        properties: { purpose: 'mobile-test', geometryType: definition.type },
                        geometry: definition.geometry,
                    },
                    expected: [201],
                    label: `Tạo draft ${definition.type}`,
                }),
            );
        }
        await request(`/mobile/drafts/${draft.id}`, {
            role: 'citizen',
            label: `Read-back draft ${definition.type}`,
        });
        drafts.push({
            id: Number(draft.id),
            title: definition.title,
            geometryType: definition.type,
        });
    }
    const lineMeasure = data(
        await request('/mobile/measure', {
            method: 'POST',
            body: { geometry: DRAFT_DEFINITIONS[1].geometry },
            label: 'Đo khoảng cách mobile',
        }),
    );
    const areaMeasure = data(
        await request('/mobile/measure', {
            method: 'POST',
            body: { geometry: DRAFT_DEFINITIONS[2].geometry },
            label: 'Đo diện tích mobile',
        }),
    );
    const weather = await optional(
        'Weather mobile',
        () =>
            request('/mobile/weather/current?longitude=107.31&latitude=21.01', {
                label: 'Đọc weather mobile',
            }),
        'OpenWeather external unavailable',
    );
    const routes = {};
    for (const profile of ['driving', 'walking', 'cycling']) {
        const result = await optional(
            `Routing ${profile}`,
            () =>
                request('/mobile/routes/shortest', {
                    method: 'POST',
                    body: { start: [107.31, 21.01], end: [107.325, 21.02], profile },
                    label: `Read-back route ${profile}`,
                }),
            'MAPBOX_DIRECTIONS_TOKEN hoặc Mapbox external unavailable',
        );
        routes[profile] = result.ok
            ? {
                  ready: true,
                  provider: data(result.value).provider,
                  distanceMeters: data(result.value).distance_m,
              }
            : { ready: false, blocker: result.blocker };
    }
    return {
        drafts,
        measure: { lengthMeters: lineMeasure.length_m, areaSquareMeters: areaMeasure.area_m2 },
        weather: {
            ready: weather.ok,
            blocker: weather.blocker || null,
            location: { longitude: 107.31, latitude: 21.01 },
        },
        routing: {
            start: [107.31, 21.01],
            end: [107.325, 21.02],
            profiles: routes,
        },
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
        const sourcePath = fixturePath('campha-mobile-raster.tif');
        assert(fs.existsSync(sourcePath), `Thiếu file fixture: ${sourcePath}`);
        const file = await upload({
            category: 'raster',
            fileName: `${prefix.toLowerCase()}-mobile-raster.tif`,
            contentType: 'image/tiff',
            sourcePath,
        });
        image = data(
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
                    description: 'GeoTIFF tối thiểu dùng nghiệm thu mobile.',
                    fileObjectId: file.id,
                },
                expected: [201],
                label: 'Tạo metadata raster',
            }),
        );
    }
    await request(`/remote-sensing/images/${image.id}`, { label: 'Read-back raster public' });
    return { id: Number(image.id), sceneCode };
};

const pollImport = async (jobId) => {
    const deadline = Date.now() + Number(process.env.API_IMPORT_TIMEOUT_MS || 120000);
    let state;
    do {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        state = data(
            await request(`/admin/layers/imports/${jobId}`, {
                role: 'so_tnmt',
                label: 'Poll import layer',
            }),
        );
    } while (!['succeeded', 'failed'].includes(state.status) && Date.now() < deadline);
    assert(
        state.status === 'succeeded',
        `Import ${state.status}: ${state.error_code || ''} ${state.error_message || ''}`,
    );
    return data(
        await request(`/admin/layers/${state.layer_id}`, {
            role: 'so_tnmt',
            label: 'Read-back layer import',
        }),
    );
};
const configureLayer = async (layer, metadata, isPublic = true) => {
    const needsMetadata = Object.entries(metadata).some(([key, value]) => {
        const current = layer.metadata?.[key];
        return JSON.stringify(current) !== JSON.stringify(value);
    });
    if (
        !needsMetadata &&
        layer.is_public === isPublic &&
        layer.min_zoom === 0 &&
        layer.max_zoom === 22
    ) {
        return layer;
    }
    return data(
        await request(`/admin/layers/${layer.id}`, {
            role: 'so_tnmt',
            method: 'PATCH',
            body: {
                expectedUpdatedAt: iso(layer.updated_at),
                minZoom: 0,
                maxZoom: 22,
                isPublic,
                metadata: { ...layer.metadata, ...metadata },
            },
            label: `Cấu hình metadata layer ${layer.code}`,
        }),
    );
};
const grantLayerRoles = async (layerId) => {
    const permissions = Object.keys(accounts).map((roleCode) => ({
        roleCode,
        canView: true,
        canExport: roleCode !== 'citizen',
        canEdit: roleCode === 'so_tnmt',
        canDelete: false,
    }));
    return data(
        await request(`/admin/layers/${layerId}/permissions`, {
            role: 'so_tnmt',
            method: 'PUT',
            body: { permissions },
            label: `Cấp quyền layer ${layerId}`,
        }),
    );
};
const publishLayer = async (layer) => {
    if (layer.publish_status === 'published') {
        return { layer, blocker: null };
    }
    const published = await optional(
        `GeoServer publish ${layer.code}`,
        () =>
            request(`/admin/layers/${layer.id}/publish`, {
                role: 'so_tnmt',
                method: 'POST',
                label: `Publish ${layer.code}`,
            }),
        'GeoServer datastore chưa trỏ acceptance DB',
    );
    return published.ok
        ? { layer: data(published.value), blocker: null }
        : { layer, blocker: published.blocker };
};
const ensurePointLayer = async () => {
    const code = `${prefix.toLowerCase()}_mobile_points`;
    let layer = await findOne(
        `/admin/layers?q=${encodeURIComponent(code)}&page=1&limit=100`,
        'so_tnmt',
        (row) => row.code === code,
        'Tìm point layer fixture',
    );
    if (!layer) {
        assert(fs.existsSync(layerWorkbook), `Thiếu workbook fixture: ${layerWorkbook}`);
        const uploaded = await upload({
            category: 'layers',
            fileName: `${prefix.toLowerCase()}-mobile-points.xlsx`,
            contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            sourcePath: layerWorkbook,
        });
        const job = data(
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
                label: 'Xếp hàng import point Excel',
            }),
        );
        layer = await pollImport(job.id);
    }
    layer = await configureLayer(layer, {
        idField: 'source_row',
        displayFields: ['name', 'x', 'y'],
        searchFields: ['name'],
        editableFields: ['name'],
    });
    const publication = await publishLayer(layer);
    layer = publication.layer;
    if (layer.publish_status === 'published') {
        await request('/web-map/layers', { label: 'Read-back web-map catalog' });
        await request(`/mobile/layers/${layer.id}/features/2`, {
            role: 'citizen',
            label: 'Read-back mobile point feature',
        });
        await request(
            `/mobile/layers/${layer.id}/nearby?longitude=107.3&latitude=21&radiusMeters=2000&limit=20`,
            { role: 'citizen', label: 'Read-back mobile point nearby' },
        );
    }
    return {
        id: Number(layer.id),
        code,
        featureId: '2',
        publishStatus: layer.publish_status,
        tableName: layer.table_name,
        blocker: publication.blocker,
    };
};
const ensureEditableLayer = async () => {
    const code = `${prefix.toLowerCase()}_editable_roads`;
    let layer = await findOne(
        `/admin/layers?q=${encodeURIComponent(code)}&page=1&limit=100`,
        'so_tnmt',
        (row) => row.code === code,
        'Tìm editable line layer',
    );
    if (!layer) {
        assert(fs.existsSync(lineLayerArchive), `Thiếu line fixture: ${lineLayerArchive}`);
        const uploaded = await upload({
            category: 'layers',
            fileName: `${prefix.toLowerCase()}-editable-roads.zip`,
            contentType: 'application/zip',
            sourcePath: lineLayerArchive,
        });
        const job = data(
            await request('/admin/layers/imports/shapefile', {
                role: 'so_tnmt',
                method: 'POST',
                body: {
                    fileObjectId: uploaded.id,
                    code,
                    nameVi: `${prefix} Tuyến đường chỉnh sửa`,
                    category: 'giao_thong',
                    targetSrid: 4326,
                    isPublic: true,
                    sourceEncoding: 'UTF-8',
                    topologyProfile: 'basic',
                },
                expected: [201],
                label: 'Xếp hàng import editable Shapefile',
            }),
        );
        layer = await pollImport(job.id);
    }
    layer = await configureLayer(layer, {
        idField: 'source_fid',
        displayFields: ['name'],
        searchFields: ['name'],
        editableFields: ['name'],
    });
    layer = await grantLayerRoles(layer.id);
    const publication = await publishLayer(layer);
    layer = publication.layer;
    if (layer.publish_status !== 'published') {
        return {
            id: Number(layer.id),
            code,
            publishStatus: layer.publish_status,
            blocker: publication.blocker || 'Layer chưa published',
        };
    }
    const catalog = await request('/web-map/layers', {
        role: 'so_tnmt',
        label: 'Read-back editable layer catalog',
    });
    const catalogLayer = items(catalog).find((row) => Number(row.id) === Number(layer.id));
    assert(catalogLayer?.canEdit === true, 'TNMT chưa có canEdit trên editable layer');
    const candidateIds = ['0', '1', '2', '3'];
    let featureId = null;
    let feature = null;
    for (const candidate of candidateIds) {
        const attempt = await optional(
            `Feature ${candidate}`,
            () =>
                request(`/mobile/layers/${layer.id}/features/${candidate}`, {
                    role: 'so_tnmt',
                    label: `Read-back editable feature ${candidate}`,
                }),
            'Feature ID khác dự kiến',
        );
        if (attempt.ok) {
            featureId = candidate;
            feature = data(attempt.value).feature;
            break;
        }
    }
    assert(featureId, 'Không tìm thấy feature line để tạo history');
    let history = data(
        await request(`/mobile/layers/${layer.id}/features/${featureId}/history`, {
            role: 'so_tnmt',
            label: 'Read-back history ban đầu',
        }),
    );
    if (!history.length) {
        const changed = data(
            await request(`/mobile/layers/${layer.id}/features/${featureId}`, {
                role: 'so_tnmt',
                method: 'PATCH',
                body: {
                    baseVersion: Number(feature.version || 1),
                    attributes: { name: `${prefix} Tuyến đã chỉnh sửa` },
                },
                label: 'Tạo version chỉnh sửa TNMT',
            }),
        );
        await request(`/mobile/layers/${layer.id}/features/${featureId}/restore/1`, {
            role: 'so_tnmt',
            method: 'POST',
            body: { baseVersion: Number(changed.version) },
            label: 'Tạo version khôi phục TNMT',
        });
        history = data(
            await request(`/mobile/layers/${layer.id}/features/${featureId}/history`, {
                role: 'so_tnmt',
                label: 'Read-back history sau restore',
            }),
        );
    }
    const latestVersion = Math.max(1, ...history.map((row) => Number(row.version)));
    const syncPrefix = Number(layer.id).toString(16).padStart(12, '0').slice(-12);
    const syncIds = {
        clientId: `b4bbef21-409c-4878-9f69-${syncPrefix}`,
        applied: `25c125ba-57ed-4b87-85be-${syncPrefix}`,
        conflict: `922dce0c-c370-419a-8114-${syncPrefix}`,
        rejected: `584a0d88-8f5a-4d84-97ae-${syncPrefix}`,
    };
    const priorApplied = data(
        await request('/mobile/sync', {
            role: 'so_tnmt',
            method: 'POST',
            body: {
                clientId: syncIds.clientId,
                changes: [
                    {
                        clientChangeId: syncIds.applied,
                        layerId: Number(layer.id),
                        featureId,
                        baseVersion: latestVersion,
                        attributes: { name: `${prefix} Đồng bộ offline thành công` },
                    },
                ],
            },
            label: 'Tạo hoặc replay applied sync',
        }),
    );
    assert(priorApplied.applied.length === 1, 'Sync fixture thiếu applied');
    const sync = data(
        await request('/mobile/sync', {
            role: 'so_tnmt',
            method: 'POST',
            body: {
                clientId: syncIds.clientId,
                changes: [
                    {
                        clientChangeId: syncIds.conflict,
                        layerId: Number(layer.id),
                        featureId,
                        baseVersion: 1,
                        attributes: { name: `${prefix} Xung đột không ghi đè` },
                    },
                    {
                        clientChangeId: syncIds.rejected,
                        layerId: Number(layer.id),
                        featureId: 'missing-fixture',
                        baseVersion: 1,
                        attributes: { name: `${prefix} Bị từ chối` },
                    },
                ],
            },
            label: 'Tạo conflict và rejected sync',
        }),
    );
    assert(sync.conflicts.length === 1, 'Sync fixture thiếu conflict');
    assert(sync.rejected.length === 1, 'Sync fixture thiếu rejected');
    return {
        id: Number(layer.id),
        code,
        featureId,
        publishStatus: layer.publish_status,
        tableName: layer.table_name,
        historyVersions: history.map((row) => Number(row.version)),
        currentVersion: Number(priorApplied.applied[0].version),
        sync: {
            clientId: syncIds.clientId,
            applied: syncIds.applied,
            conflict: syncIds.conflict,
            rejected: syncIds.rejected,
        },
        blocker: null,
    };
};

const verifyNegativeRbac = async (editableLayer) => {
    await request('/admin/layers?page=1&limit=10', {
        role: 'citizen',
        expected: [403],
        label: 'RBAC citizen bị chặn admin layers',
    });
    if (editableLayer?.id && editableLayer?.featureId) {
        for (const role of ['citizen', 'system_admin', 'ubnd_tp', 'so_xd']) {
            await request(
                `/mobile/layers/${editableLayer.id}/features/${editableLayer.featureId}`,
                {
                    role,
                    method: 'PATCH',
                    body: { baseVersion: 1, attributes: { name: 'forbidden' } },
                    expected: [403],
                    label: `RBAC ${role} bị chặn sửa feature`,
                },
            );
        }
    }
    await request('/auth/me', { expected: [401], label: 'Anonymous bị chặn profile' });
};

const writeManifest = (fixtures) => {
    const moduleStatus = (ready, blocker = null) => ({
        status: ready ? 'ready' : 'conditional',
        ...(blocker ? { blocker } : {}),
    });
    const routeReady = Object.values(fixtures.mobile.routing.profiles).every((row) => row.ready);
    const routeBlocker = Object.values(fixtures.mobile.routing.profiles).find(
        (row) => !row.ready,
    )?.blocker;
    const manifest = {
        schemaVersion: 2,
        generatedAt: new Date().toISOString(),
        baseUrl,
        apiBaseUrl: apiRoot,
        prefix,
        database: databaseName,
        fixturePolicy: 'business fixtures created and read back through HTTP API only',
        accounts: Object.entries(accounts).map(([role, email]) => ({ role, email })),
        fixtures,
        modules: {
            auth: moduleStatus(true),
            cms: moduleStatus(true),
            files: moduleStatus(true),
            raster: moduleStatus(Boolean(fixtures.raster?.id), fixtures.raster?.blocker),
            fieldReports: moduleStatus(fixtures.fieldReports?.reports?.length === 6),
            push: moduleStatus(
                fixtures.fieldReports?.pushReady,
                fixtures.fieldReports?.pushBlocker,
            ),
            mobileDraftMeasure: moduleStatus(fixtures.mobile?.drafts?.length === 3),
            mobileWeather: moduleStatus(
                fixtures.mobile?.weather?.ready,
                fixtures.mobile?.weather?.blocker,
            ),
            routing: moduleStatus(routeReady, routeBlocker),
            map: moduleStatus(
                fixtures.layers?.point?.publishStatus === 'published',
                fixtures.layers?.point?.blocker,
            ),
            featureEditing: moduleStatus(
                fixtures.layers?.editable?.publishStatus === 'published' &&
                    Boolean(fixtures.layers?.editable?.featureId),
                fixtures.layers?.editable?.blocker,
            ),
            offlineQueue: {
                status: 'manual',
                blocker:
                    'Queue nằm trong SQLite mobile; tắt mạng và lưu edit trên thiết bị để tạo item.',
            },
            registrationEmail: {
                status: 'manual',
                blocker:
                    'Dùng email mới; SMTP và REQUIRE_EMAIL_VERIFICATION quyết định nhánh kết quả.',
            },
        },
        endpoints: {
            login: '/api/v1/auth/login',
            register: '/api/v1/auth/register',
            news: '/api/v1/cms/news',
            documents: '/api/v1/cms/documents',
            pdfMaps: '/api/v1/cms/pdf-maps',
            fieldReports: '/api/v1/field-reports/public',
            drafts: '/api/v1/mobile/drafts',
            measure: '/api/v1/mobile/measure',
            weather: '/api/v1/mobile/weather/current?longitude=107.31&latitude=21.01',
            routing: '/api/v1/mobile/routes/shortest',
            mapCatalog: '/api/v1/web-map/layers',
            featureSync: '/api/v1/mobile/sync',
        },
        evidence: {
            requestCount: evidence.length,
            writes: evidence.filter((row) => !['GET', 'HEAD'].includes(row.method)).length,
            readBacks: evidence.filter((row) => row.label.includes('Read-back')).length,
        },
        secrets: 'No token, API key, password, credential or presigned URL stored.',
    };
    const serialized = JSON.stringify(manifest, null, 2);
    assert(
        !/(accessToken|refreshToken|apiKey|password|uploadUrl)\s*"\s*:/i.test(serialized),
        'Manifest chứa secret field',
    );
    fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
    fs.writeFileSync(manifestPath, `${serialized}\n`, 'utf8');
    console.log(`Manifest: ${manifestPath}`);
};

(async () => {
    ensureFixtureFiles();
    bootstrapStage = 'health';
    const health = await request(`${baseUrl}/health`, { label: 'Health server' });
    assert(health.body?.status === 'OK', 'Health payload không OK');
    bootstrapStage = 'auth';
    await loginAll();
    bootstrapFixtures.authReady = true;
    bootstrapStage = 'news';
    bootstrapFixtures.news = await ensureNews();
    bootstrapStage = 'documents';
    bootstrapFixtures.content = await ensureDocuments();
    bootstrapStage = 'fieldReports';
    bootstrapFixtures.fieldReports = await ensureFieldReports();
    bootstrapStage = 'mobileTools';
    bootstrapFixtures.mobile = await ensureMobileTools();
    bootstrapStage = 'raster';
    const raster = await optional(
        'Raster fixture',
        ensureRaster,
        'MinIO/raster service unavailable',
    );
    bootstrapFixtures.raster = raster.ok ? raster.value : { blocker: raster.blocker };
    bootstrapStage = 'pointLayer';
    const point = await optional(
        'Import và publish point layer',
        ensurePointLayer,
        'Upload/import worker/GDAL/GeoServer chưa sẵn sàng',
    );
    bootstrapStage = 'editableLayer';
    const editable = await optional(
        'Import và cấu hình editable line layer',
        ensureEditableLayer,
        'Line Shapefile/import worker/GDAL/GeoServer chưa sẵn sàng',
    );
    bootstrapFixtures.layers = {
        point: point.ok ? point.value : { publishStatus: 'unavailable', blocker: point.blocker },
        editable: editable.ok
            ? editable.value
            : { publishStatus: 'unavailable', blocker: editable.blocker },
    };
    bootstrapStage = 'rbac';
    await verifyNegativeRbac(bootstrapFixtures.layers.editable);
    bootstrapStage = 'complete';
    writeManifest(bootstrapFixtures);
    console.log(`API bootstrap đạt: ${evidence.length} request có bằng chứng.`);
})().catch((error) => {
    const blocker = safeBlocker(error.message);
    const moduleStatus = (ready, reason = null) => ({
        status: ready ? 'ready' : 'conditional',
        ...(!ready && reason ? { blocker: reason } : {}),
    });
    const partialManifest = {
        schemaVersion: 2,
        generatedAt: new Date().toISOString(),
        baseUrl,
        apiBaseUrl: apiRoot,
        prefix,
        database: databaseName,
        fixturePolicy: 'business fixtures created and read back through HTTP API only',
        accounts: Object.entries(accounts).map(([role, email]) => ({ role, email })),
        fixtures: bootstrapFixtures,
        modules: {
            auth: moduleStatus(Boolean(bootstrapFixtures.authReady), blocker),
            cmsNews: moduleStatus(Boolean(bootstrapFixtures.news), blocker),
            files: moduleStatus(Boolean(bootstrapFixtures.content), blocker),
            cmsDocuments: moduleStatus(Boolean(bootstrapFixtures.content), blocker),
            fieldReports: moduleStatus(Boolean(bootstrapFixtures.fieldReports), blocker),
            mobileDraftMeasure: moduleStatus(Boolean(bootstrapFixtures.mobile), blocker),
            raster: moduleStatus(Boolean(bootstrapFixtures.raster?.id), blocker),
            map: moduleStatus(
                bootstrapFixtures.layers?.point?.publishStatus === 'published',
                blocker,
            ),
            featureEditing: moduleStatus(
                bootstrapFixtures.layers?.editable?.publishStatus === 'published',
                blocker,
            ),
            routing: moduleStatus(Boolean(bootstrapFixtures.mobile?.routing?.profiles), blocker),
            mobileWeather: moduleStatus(Boolean(bootstrapFixtures.mobile?.weather), blocker),
            offlineQueue: {
                status: 'manual',
                blocker:
                    'Queue nằm trong SQLite mobile; tắt mạng và lưu edit trên thiết bị để tạo item.',
            },
            registrationEmail: {
                status: 'manual',
                blocker:
                    'Dùng email mới; SMTP và REQUIRE_EMAIL_VERIFICATION quyết định nhánh kết quả.',
            },
        },
        evidence: {
            bootstrapStatus: 'blocked',
            blockerStage: bootstrapStage,
            requestCount: evidence.length,
        },
        secrets: 'No token, API key, password, credential or presigned URL stored.',
    };
    const serialized = JSON.stringify(partialManifest, null, 2);
    assert(
        !/(accessToken|refreshToken|apiKey|password|uploadUrl)\s*"\s*:/i.test(serialized),
        'Manifest blocked chứa secret field',
    );
    fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
    fs.writeFileSync(manifestPath, `${serialized}\n`, 'utf8');
    console.error(`API bootstrap thất bại tại ${bootstrapStage}: ${blocker}`);
    process.exitCode = 1;
});
