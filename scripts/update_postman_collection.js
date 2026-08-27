'use strict';

const fs = require('fs');
const path = require('path');

const collPath = path.resolve(__dirname, '../docs/api/campha.postman_collection.json');
const envPath = path.resolve(__dirname, '../docs/api/local.postman_environment.json');

const coll = JSON.parse(fs.readFileSync(collPath, 'utf8'));
const env = JSON.parse(fs.readFileSync(envPath, 'utf8'));

function makeUrl(pathStr, queryParams = []) {
    const cleanPath = pathStr.replace(/^\/+/, '');
    const pathParts = cleanPath.split('/');
    const rawQuery = queryParams.length > 0
        ? '?' + queryParams.map(q => `${q.key}=${q.value}`).join('&')
        : '';
    const obj = {
        raw: `{{baseUrl}}/${cleanPath}${rawQuery}`,
        host: ['{{baseUrl}}'],
        path: pathParts
    };
    if (queryParams.length > 0) {
        obj.query = queryParams.map(q => ({
            key: q.key,
            value: String(q.value)
        }));
    }
    return obj;
}

function bearerAuth(tokenVar = '{{tnmtToken}}') {
    return {
        type: 'bearer',
        bearer: [
            {
                key: 'token',
                value: tokenVar,
                type: 'string'
            }
        ]
    };
}

function noAuth() {
    return {
        type: 'noauth'
    };
}

function testScript(execLines) {
    return [
        {
            listen: 'test',
            script: {
                type: 'text/javascript',
                exec: Array.isArray(execLines) ? execLines : [execLines]
            }
        }
    ];
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. BUILD NGẬP LỤT (FLOOD) FOLDER
// ─────────────────────────────────────────────────────────────────────────────

const floodPublicItems = [
    {
        name: 'Tổng quan ngập lụt',
        request: {
            method: 'GET',
            header: [],
            url: makeUrl('api/v1/flood/overview'),
            description: 'Lấy thông tin tổng quan về các lần chạy phân tích ngập lụt, lớp bản đồ đã công bố và thống kê mới nhất.'
        },
        event: testScript("pm.test('200 OK', () => pm.response.to.have.status(200));")
    },
    {
        name: 'Chú giải ngập lụt',
        request: {
            method: 'GET',
            header: [],
            url: makeUrl('api/v1/flood/legends', [{ key: 'module', value: 'trend' }]),
            description: 'Lấy danh sách bảng màu và nhãn chú giải cho các module ngập lụt (event, hand, rain, impact, trend).'
        },
        event: testScript("pm.test('200 OK', () => pm.response.to.have.status(200));")
    },
    {
        name: 'Danh sách lớp ngập lụt',
        request: {
            method: 'GET',
            header: [],
            url: makeUrl('api/v1/flood/layers', [{ key: 'page', value: '1' }, { key: 'limit', value: '20' }]),
            description: 'Danh sách các lớp bản đồ ngập lụt đã được công bố ra công chúng.'
        },
        event: testScript("pm.test('200 OK', () => pm.response.to.have.status(200));")
    },
    {
        name: 'Danh sách lần chạy công khai',
        request: {
            method: 'GET',
            header: [],
            url: makeUrl('api/v1/flood/runs', [{ key: 'page', value: '1' }, { key: 'limit', value: '20' }]),
            description: 'Danh sách lịch sử các đợt phân tích ngập lụt ở chế độ product phục vụ cộng đồng.'
        },
        event: testScript([
            "pm.test('200 OK', () => pm.response.to.have.status(200));",
            "const a = pm.response.json().data?.items || []; if (a[0]?.id) { pm.collectionVariables.set('floodRunId', a[0].id); }"
        ])
    },
    {
        name: 'Mô phỏng ngập lụt (GET)',
        request: {
            method: 'GET',
            header: [],
            url: makeUrl('api/v1/flood/simulation', [{ key: 'rainfall', value: '120' }, { key: 'tide', value: '2.5' }]),
            description: 'Mô phỏng mức độ ngập lụt dựa trên lượng mưa (mm) và mực nước triều (m) truyền qua query params.'
        },
        event: testScript("pm.test('200 OK', () => pm.response.to.have.status(200));")
    },
    {
        name: 'Mô phỏng ngập lụt (POST)',
        request: {
            method: 'POST',
            header: [{ key: 'Content-Type', value: 'application/json' }],
            body: {
                mode: 'raw',
                raw: JSON.stringify({ rainfall: 120, tide: 2.5 }, null, 2),
                options: { raw: { language: 'json' } }
            },
            url: makeUrl('api/v1/flood/simulation'),
            description: 'Mô phỏng mức độ ngập lụt theo lượng mưa và triều cường qua JSON body.'
        },
        event: testScript("pm.test('200 OK', () => pm.response.to.have.status(200));")
    },
    {
        name: 'Danh sách kịch bản ngập úng',
        request: {
            method: 'GET',
            header: [],
            url: makeUrl('api/v1/flood/scenarios', [{ key: 'page', value: '1' }, { key: 'limit', value: '20' }, { key: 'activeOnly', value: 'true' }]),
            description: 'Danh sách các kịch bản ngập úng được định nghĩa sẵn đang kích hoạt.'
        },
        event: testScript([
            "pm.test('200 OK', () => pm.response.to.have.status(200));",
            "const a = pm.response.json().data?.items || []; if (a[0]?.id) { pm.collectionVariables.set('floodScenarioId', a[0].id); pm.environment.set('floodScenarioId', a[0].id); }"
        ])
    },
    {
        name: 'Chi tiết kịch bản ngập úng',
        request: {
            method: 'GET',
            header: [],
            url: makeUrl('api/v1/flood/scenarios/{{floodScenarioId}}'),
            description: 'Xem thông tin chi tiết một kịch bản ngập úng theo ID.'
        },
        event: testScript("pm.test('200 OK', () => pm.response.to.have.status(200));")
    }
];

const floodAdminItems = [
    {
        name: 'Dashboard ngập lụt',
        request: {
            method: 'GET',
            auth: bearerAuth('{{tnmtToken}}'),
            header: [],
            url: makeUrl('api/v1/admin/flood/dashboard'),
            description: 'Bảng điều khiển quản trị tổng hợp tất cả trạng thái lần chạy, hàng đợi và thống kê ngập lụt.'
        },
        event: testScript("pm.test('200 OK', () => pm.response.to.have.status(200));")
    },
    {
        name: 'Cấu hình ngập lụt',
        request: {
            method: 'GET',
            auth: bearerAuth('{{tnmtToken}}'),
            header: [],
            url: makeUrl('api/v1/admin/flood/config'),
            description: 'Lấy các tham số mặc định và phiên bản pipeline của các module ngập lụt.'
        },
        event: testScript("pm.test('200 OK', () => pm.response.to.have.status(200));")
    },
    {
        name: 'Cấu hình mô hình xu thế (Trend Config)',
        request: {
            method: 'GET',
            auth: bearerAuth('{{tnmtToken}}'),
            header: [],
            url: makeUrl('api/v1/admin/flood/trend/config'),
            description: 'Lấy cấu hình chi tiết mô hình xu thế ngập FINAL (ngưỡng HAND, độ dốc, diện tích mảng tối thiểu, v.v.).'
        },
        event: testScript("pm.test('200 OK', () => pm.response.to.have.status(200));")
    },
    {
        name: 'Cập nhật cấu hình mô hình xu thế',
        request: {
            method: 'PUT',
            auth: bearerAuth('{{tnmtToken}}'),
            header: [{ key: 'Content-Type', value: 'application/json' }],
            body: {
                mode: 'raw',
                raw: JSON.stringify({
                    handThresh: 15,
                    slopeThresh: 5,
                    minPatchPixels: 10
                }, null, 2),
                options: { raw: { language: 'json' } }
            },
            url: makeUrl('api/v1/admin/flood/trend/config'),
            description: 'Cập nhật ghi đè các tham số của mô hình xu thế ngập.'
        },
        event: testScript("pm.test('200 OK', () => pm.response.to.have.status(200));")
    },
    {
        name: 'Đặt lại một tham số cấu hình xu thế',
        request: {
            method: 'DELETE',
            auth: bearerAuth('{{tnmtToken}}'),
            header: [],
            url: makeUrl('api/v1/admin/flood/trend/config/{{floodTrendConfigKey}}'),
            description: 'Xóa giá trị ghi đè của một tham số (ví dụ: handThresh) và trở về giá trị mặc định.'
        },
        event: testScript("pm.test('200 OK', () => pm.response.to.have.status(200));")
    },
    {
        name: 'Đặt lại toàn bộ cấu hình xu thế',
        request: {
            method: 'DELETE',
            auth: bearerAuth('{{tnmtToken}}'),
            header: [],
            url: makeUrl('api/v1/admin/flood/trend/config'),
            description: 'Xóa toàn bộ các tham số ghi đè của mô hình xu thế ngập.'
        },
        event: testScript("pm.test('200 OK', () => pm.response.to.have.status(200));")
    },
    {
        name: 'Danh sách kịch bản ngập úng (Quản trị)',
        request: {
            method: 'GET',
            auth: bearerAuth('{{tnmtToken}}'),
            header: [],
            url: makeUrl('api/v1/admin/flood/scenarios', [{ key: 'page', value: '1' }, { key: 'limit', value: '20' }]),
            description: 'Xem danh sách toàn bộ các kịch bản ngập úng (bao gồm cả active và inactive).'
        },
        event: testScript([
            "pm.test('200 OK', () => pm.response.to.have.status(200));",
            "const a = pm.response.json().data?.items || []; if (a[0]?.id) { pm.collectionVariables.set('floodScenarioId', a[0].id); pm.environment.set('floodScenarioId', a[0].id); }"
        ])
    },
    {
        name: 'Chi tiết kịch bản ngập úng (Quản trị)',
        request: {
            method: 'GET',
            auth: bearerAuth('{{tnmtToken}}'),
            header: [],
            url: makeUrl('api/v1/admin/flood/scenarios/{{floodScenarioId}}'),
            description: 'Xem chi tiết một kịch bản ngập úng trong phần quản trị.'
        },
        event: testScript("pm.test('200 OK', () => pm.response.to.have.status(200));")
    },
    {
        name: 'Tạo kịch bản ngập úng',
        request: {
            method: 'POST',
            auth: bearerAuth('{{tnmtToken}}'),
            header: [{ key: 'Content-Type', value: 'application/json' }],
            body: {
                mode: 'raw',
                raw: JSON.stringify({
                    code: 'kich_ban_mua_lon_trieu_cuong',
                    nameVi: 'Kịch bản mưa lớn kết hợp triều cường',
                    minRainfall: 100,
                    maxRainfall: 250,
                    minTide: 2.0,
                    maxTide: 4.5,
                    layerCode: 'lop_phu_sau_ngap_2026',
                    description: 'Kịch bản dự báo ngập lụt vùng ven biển Cẩm Phả khi có bão và triều dâng',
                    isActive: true,
                    currentRainfall: 120,
                    rainfallSource: 'MANUAL',
                    currentTide: 2.8,
                    tideSource: 'MANUAL'
                }, null, 2),
                options: { raw: { language: 'json' } }
            },
            url: makeUrl('api/v1/admin/flood/scenarios'),
            description: 'Tạo một kịch bản ngập úng mới gắn với lớp bản đồ.'
        },
        event: testScript([
            "pm.test('201 Created', () => pm.response.to.have.status(201));",
            "const d = pm.response.json().data; if (d?.id) { pm.collectionVariables.set('floodScenarioId', d.id); pm.environment.set('floodScenarioId', d.id); }"
        ])
    },
    {
        name: 'Cập nhật kịch bản ngập úng',
        request: {
            method: 'PUT',
            auth: bearerAuth('{{tnmtToken}}'),
            header: [{ key: 'Content-Type', value: 'application/json' }],
            body: {
                mode: 'raw',
                raw: JSON.stringify({
                    nameVi: 'Kịch bản mưa lớn kết hợp triều cường (Cập nhật)',
                    minRainfall: 120,
                    maxRainfall: 300,
                    minTide: 2.5,
                    maxTide: 5.0,
                    isActive: true
                }, null, 2),
                options: { raw: { language: 'json' } }
            },
            url: makeUrl('api/v1/admin/flood/scenarios/{{floodScenarioId}}'),
            description: 'Cập nhật thông tin ngưỡng và trạng thái kịch bản ngập úng.'
        },
        event: testScript("pm.test('200 OK', () => pm.response.to.have.status(200));")
    },
    {
        name: 'Xóa kịch bản ngập úng',
        request: {
            method: 'DELETE',
            auth: bearerAuth('{{tnmtToken}}'),
            header: [],
            url: makeUrl('api/v1/admin/flood/scenarios/{{floodScenarioId}}'),
            description: 'Xóa kịch bản ngập úng khỏi hệ thống.'
        },
        event: testScript("pm.test('200 OK', () => pm.response.to.have.status(200));")
    },
    {
        name: 'Hàng đợi xử lý',
        request: {
            method: 'GET',
            auth: bearerAuth('{{tnmtToken}}'),
            header: [],
            url: makeUrl('api/v1/admin/flood/queue'),
            description: 'Xem trạng thái các tác vụ phân tích ngập đang nằm trong hàng đợi hoặc đang thực thi.'
        },
        event: testScript("pm.test('200 OK', () => pm.response.to.have.status(200));")
    },
    {
        name: 'Danh sách lần chạy quản trị',
        request: {
            method: 'GET',
            auth: bearerAuth('{{tnmtToken}}'),
            header: [],
            url: makeUrl('api/v1/admin/flood/runs', [{ key: 'page', value: '1' }, { key: 'limit', value: '20' }]),
            description: 'Danh sách tất cả các lần chạy phân tích ngập lụt với đầy đủ trạng thái và thông tin chi tiết.'
        },
        event: testScript([
            "pm.test('200 OK', () => pm.response.to.have.status(200));",
            "const a = pm.response.json().data?.items || []; if (a[0]?.id) { pm.collectionVariables.set('floodRunId', a[0].id); pm.environment.set('floodRunId', a[0].id); }"
        ])
    },
    {
        name: 'Chi tiết lần chạy',
        request: {
            method: 'GET',
            auth: bearerAuth('{{tnmtToken}}'),
            header: [],
            url: makeUrl('api/v1/admin/flood/runs/{{floodRunId}}'),
            description: 'Chi tiết một lần chạy phân tích ngập lụt kèm danh sách artifacts và tiến trình từng bước.'
        },
        event: testScript([
            "pm.test('200 OK', () => pm.response.to.have.status(200));",
            "const d = pm.response.json().data; const a = d?.artifacts || []; if (a[0]?.id) { pm.collectionVariables.set('floodArtifactId', a[0].id); pm.environment.set('floodArtifactId', a[0].id); }"
        ])
    },
    {
        name: 'Tạo lần chạy',
        request: {
            method: 'POST',
            auth: bearerAuth('{{tnmtToken}}'),
            header: [{ key: 'Content-Type', value: 'application/json' }],
            body: {
                mode: 'raw',
                raw: JSON.stringify({
                    module: 'event',
                    mode: 'product',
                    config: {}
                }, null, 2),
                options: { raw: { language: 'json' } }
            },
            url: makeUrl('api/v1/admin/flood/runs'),
            description: 'Đưa một lượt phân tích ngập lụt mới vào hàng đợi (module: event, hand, impact, trend).'
        },
        event: testScript([
            "pm.test('Accepted', () => pm.expect(pm.response.code).to.be.oneOf([200, 201, 202]));",
            "const d = pm.response.json().data; if (d?.id) { pm.collectionVariables.set('floodRunId', d.id); pm.environment.set('floodRunId', d.id); }"
        ])
    },
    {
        name: 'Chạy lại',
        request: {
            method: 'POST',
            auth: bearerAuth('{{tnmtToken}}'),
            header: [],
            url: makeUrl('api/v1/admin/flood/runs/{{floodRunId}}/rerun'),
            description: 'Chạy lại một lần phân tích ngập lụt đã thực hiện.'
        },
        event: testScript("pm.test('Accepted', () => pm.expect(pm.response.code).to.be.oneOf([200, 201, 202]));")
    },
    {
        name: 'Hủy lần chạy',
        request: {
            method: 'POST',
            auth: bearerAuth('{{tnmtToken}}'),
            header: [],
            url: makeUrl('api/v1/admin/flood/runs/{{floodRunId}}/cancel'),
            description: 'Hủy một lần phân tích ngập lụt đang chờ hoặc đang xử lý.'
        },
        event: testScript("pm.test('200 OK', () => pm.response.to.have.status(200));")
    },
    {
        name: 'Xuất bản artifact',
        request: {
            method: 'POST',
            auth: bearerAuth('{{tnmtToken}}'),
            header: [],
            url: makeUrl('api/v1/admin/flood/artifacts/{{floodArtifactId}}/publish'),
            description: 'Công bố một artifact kết quả ngập lụt lên bản đồ công khai.'
        },
        event: testScript("pm.test('200 OK', () => pm.response.to.have.status(200));")
    },
    {
        name: 'Gỡ xuất bản artifact',
        request: {
            method: 'POST',
            auth: bearerAuth('{{tnmtToken}}'),
            header: [],
            url: makeUrl('api/v1/admin/flood/artifacts/{{floodArtifactId}}/unpublish'),
            description: 'Thu hồi công bố của một artifact kết quả ngập lụt.'
        },
        event: testScript("pm.test('200 OK', () => pm.response.to.have.status(200));")
    },
    {
        name: 'Danh sách chú giải quản trị',
        request: {
            method: 'GET',
            auth: bearerAuth('{{tnmtToken}}'),
            header: [],
            url: makeUrl('api/v1/admin/flood/legends', [{ key: 'module', value: 'trend' }]),
            description: 'Lấy cấu hình chi tiết chú giải cho vai trò quản trị (bao gồm dải màu, nhãn ngôn ngữ, giá trị min/max).'
        },
        event: testScript("pm.test('200 OK', () => pm.response.to.have.status(200));")
    },
    {
        name: 'Cập nhật chú giải',
        request: {
            method: 'PUT',
            auth: bearerAuth('{{tnmtToken}}'),
            header: [{ key: 'Content-Type', value: 'application/json' }],
            body: {
                mode: 'raw',
                raw: JSON.stringify({
                    label: {
                        vi: 'Tần suất ngập',
                        en: 'Flood Frequency'
                    },
                    palette: [
                        'ffffff',
                        '00aaff',
                        '0000ff'
                    ],
                    min: 0,
                    max: 100
                }, null, 2),
                options: { raw: { language: 'json' } }
            },
            url: makeUrl('api/v1/admin/flood/legends/{{floodLegendCode}}'),
            description: 'Tùy biến nhãn và dải màu palette cho chú giải artifact ngập lụt.'
        },
        event: testScript("pm.test('200 OK', () => pm.response.to.have.status(200));")
    },
    {
        name: 'Đặt lại chú giải về mặc định',
        request: {
            method: 'DELETE',
            auth: bearerAuth('{{tnmtToken}}'),
            header: [],
            url: makeUrl('api/v1/admin/flood/legends/{{floodLegendCode}}'),
            description: 'Khôi phục thiết lập chú giải về cấu hình mặc định ban đầu.'
        },
        event: testScript("pm.test('200 OK', () => pm.response.to.have.status(200));")
    },
    {
        name: 'Kích hoạt phân tích ngập hàng ngày thủ công',
        request: {
            method: 'POST',
            auth: bearerAuth('{{tnmtToken}}'),
            header: [],
            url: makeUrl('api/v1/admin/flood/daily/trigger'),
            description: 'Kích hoạt thủ công tiến trình phân tích phát hiện ngập lụt hàng ngày (Daily Cron job).'
        },
        event: testScript("pm.test('200 OK', () => pm.response.to.have.status(200));")
    }
];

const floodFolder = {
    name: 'Ngập lụt',
    description: 'API Flood/Hydrology (Ngập lụt) Cẩm Phả bao gồm: phát hiện ngập theo đợt (event), mô hình HAND, xu thế ngập (trend), mô phỏng kịch bản ngập úng, quản lý hàng đợi và xuất bản artifact.',
    item: [
        {
            name: 'Công khai',
            description: 'Các API ngập lụt tra cứu công khai không yêu cầu token đăng nhập.',
            item: floodPublicItems
        },
        {
            name: 'Quản trị',
            description: 'Các API quản trị quy trình phân tích ngập lụt, cấu hình tham số, kịch bản ngập úng và chú giải (dùng tnmtToken hoặc adminToken).',
            item: floodAdminItems
        }
    ]
};

// ─────────────────────────────────────────────────────────────────────────────
// 2. BUILD PHÂN LOẠI ĐỐI TƯỢNG (FOREST CLASSIFICATION) FOLDER
// ─────────────────────────────────────────────────────────────────────────────

const forestPublicItems = [
    {
        name: 'Lấy kết quả Phân loại đối tượng mới nhất',
        request: {
            method: 'GET',
            auth: noAuth(),
            header: [],
            url: makeUrl('api/v1/forest-classification/latest'),
            description: 'Lấy snapshot kết quả phân loại đối tượng / lớp phủ mới nhất cùng so sánh với kỳ liền trước và trạng thái tính toán.'
        },
        event: testScript([
            "pm.test('200 OK', () => pm.response.to.have.status(200));",
            "const d = pm.response.json().data;",
            "if (d?.snapshot?.id) {",
            "    pm.collectionVariables.set('forestSnapshotId', d.snapshot.id);",
            "    pm.environment.set('forestSnapshotId', d.snapshot.id);",
            "}"
        ])
    },
    {
        name: 'Truy vấn kết quả theo kỳ',
        request: {
            method: 'POST',
            auth: noAuth(),
            header: [{ key: 'Content-Type', value: 'application/json' }],
            body: {
                mode: 'raw',
                raw: JSON.stringify({
                    year: 2026,
                    month: 3
                }, null, 2),
                options: { raw: { language: 'json' } }
            },
            url: makeUrl('api/v1/forest-classification/query'),
            description: 'Truy vấn kết quả phân loại đối tượng theo năm và tháng. Trả về kết quả đã cache hoặc bắt đầu xử lý nếu chưa có.'
        },
        event: testScript([
            "pm.test('200 OK', () => pm.response.to.have.status(200));",
            "const d = pm.response.json().data;",
            "if (d?.snapshot?.id) {",
            "    pm.collectionVariables.set('forestSnapshotId', d.snapshot.id);",
            "    pm.environment.set('forestSnapshotId', d.snapshot.id);",
            "}"
        ])
    },
    {
        name: 'Chi tiết kết quả phân loại đối tượng',
        request: {
            method: 'GET',
            auth: noAuth(),
            header: [],
            url: makeUrl('api/v1/forest-classification/snapshot/{{forestSnapshotId}}'),
            description: 'Xem chi tiết snapshot phân loại đối tượng theo ID (diện tích các loại đối tượng, độ chính xác Kappa/OOB, GeoServer layer, GEE download URL).'
        },
        event: testScript("pm.test('200 OK', () => pm.response.to.have.status(200));")
    },
    {
        name: 'Danh sách kỳ phân loại đã công bố',
        request: {
            method: 'GET',
            auth: noAuth(),
            header: [],
            url: makeUrl('api/v1/forest-classification/published-history', [{ key: 'page', value: '1' }, { key: 'limit', value: '24' }]),
            description: 'Danh sách các kỳ phân loại đối tượng đã được xuất bản chính thức cho cộng đồng xem trên Web Map.'
        },
        event: testScript([
            "pm.test('200 OK', () => pm.response.to.have.status(200));",
            "const a = pm.response.json().data?.items || [];",
            "if (a[0]?.id) {",
            "    pm.collectionVariables.set('forestSnapshotId', a[0].id);",
            "    pm.environment.set('forestSnapshotId', a[0].id);",
            "}"
        ])
    }
];

const forestAdminItems = [
    {
        name: 'Toàn bộ lịch sử các kỳ phân loại',
        request: {
            method: 'GET',
            auth: bearerAuth('{{tnmtToken}}'),
            header: [],
            url: makeUrl('api/v1/forest-classification/history', [{ key: 'page', value: '1' }, { key: 'limit', value: '24' }]),
            description: 'Xem toàn bộ lịch sử các lần chạy phân loại đối tượng (bao gồm đang tính toán, thành công, lỗi và đã xuất bản).'
        },
        event: testScript([
            "pm.test('200 OK', () => pm.response.to.have.status(200));",
            "const a = pm.response.json().data?.items || [];",
            "if (a[0]?.id) {",
            "    pm.collectionVariables.set('forestSnapshotId', a[0].id);",
            "    pm.environment.set('forestSnapshotId', a[0].id);",
            "}"
        ])
    },
    {
        name: 'Yêu cầu làm mới / chạy phân loại đối tượng',
        request: {
            method: 'POST',
            auth: bearerAuth('{{tnmtToken}}'),
            header: [{ key: 'Content-Type', value: 'application/json' }],
            body: {
                mode: 'raw',
                raw: JSON.stringify({
                    year: 2026,
                    month: 3,
                    cloudCover: 20
                }, null, 2),
                options: { raw: { language: 'json' } }
            },
            url: makeUrl('api/v1/forest-classification/refresh'),
            description: 'Yêu cầu trigger chạy quy trình phân loại đối tượng tự động trên Google Earth Engine cho kỳ chỉ định.'
        },
        event: testScript("pm.test('Accepted', () => pm.expect(pm.response.code).to.be.oneOf([200, 201, 202]));")
    },
    {
        name: 'Xuất bản raster lên Web Map (GeoServer)',
        request: {
            method: 'POST',
            auth: bearerAuth('{{tnmtToken}}'),
            header: [],
            url: makeUrl('api/v1/forest-classification/snapshots/{{forestSnapshotId}}/publish-raster', [{ key: 'force', value: '0' }]),
            description: 'Đưa snapshot phân loại thành công vào hàng đợi ingest raster để tạo layer GeoServer và công bố lên Web Map.'
        },
        event: testScript("pm.test('Accepted/OK', () => pm.expect(pm.response.code).to.be.oneOf([200, 201, 202]));")
    }
];

const forestGroundTruthItems = [
    {
        name: 'Danh sách vùng mẫu (Zones)',
        request: {
            method: 'GET',
            auth: bearerAuth('{{tnmtToken}}'),
            header: [],
            url: makeUrl('api/v1/forest-classification/ground-truth/zones', [{ key: 'page', value: '1' }, { key: 'limit', value: '50' }]),
            description: 'Danh sách các vùng đa giác mẫu kiểm chứng thực địa (Ground Truth Zones).'
        },
        event: testScript([
            "pm.test('200 OK', () => pm.response.to.have.status(200));",
            "const a = pm.response.json().data?.items || [];",
            "if (a[0]?.id) {",
            "    pm.collectionVariables.set('forestZoneId', a[0].id);",
            "    pm.environment.set('forestZoneId', a[0].id);",
            "}"
        ])
    },
    {
        name: 'Thêm vùng mẫu (Zone)',
        request: {
            method: 'POST',
            auth: bearerAuth('{{tnmtToken}}'),
            header: [{ key: 'Content-Type', value: 'application/json' }],
            body: {
                mode: 'raw',
                raw: JSON.stringify({
                    name: 'Vùng rừng phòng hộ Cẩm Phả 01',
                    observedAt: '2026-08-01T08:00:00.000Z',
                    classId: 1,
                    source: 'Khảo sát thực địa',
                    notes: 'Rừng phát triển ổn định',
                    geom: {
                        type: 'Polygon',
                        coordinates: [
                            [
                                [107.35, 21.01],
                                [107.36, 21.01],
                                [107.36, 21.02],
                                [107.35, 21.02],
                                [107.35, 21.01]
                            ]
                        ]
                    }
                }, null, 2),
                options: { raw: { language: 'json' } }
            },
            url: makeUrl('api/v1/forest-classification/ground-truth/zones'),
            description: 'Tạo mới một vùng mẫu kiểm chứng (GeoJSON Polygon hoặc MultiPolygon, classId từ 0 đến 7).'
        },
        event: testScript([
            "pm.test('201 Created', () => pm.response.to.have.status(201));",
            "const d = pm.response.json().data;",
            "if (d?.id) {",
            "    pm.collectionVariables.set('forestZoneId', d.id);",
            "    pm.environment.set('forestZoneId', d.id);",
            "}"
        ])
    },
    {
        name: 'Thêm hàng loạt vùng mẫu (Bulk Zones)',
        request: {
            method: 'POST',
            auth: bearerAuth('{{tnmtToken}}'),
            header: [{ key: 'Content-Type', value: 'application/json' }],
            body: {
                mode: 'raw',
                raw: JSON.stringify({
                    features: [
                        {
                            type: 'Feature',
                            properties: {
                                name: 'Vùng mẫu rừng tự nhiên',
                                observedAt: '2026-08-01T08:00:00.000Z',
                                classId: 1,
                                source: 'Khảo sát thực địa'
                            },
                            geometry: {
                                type: 'Polygon',
                                coordinates: [
                                    [
                                        [107.35, 21.01],
                                        [107.36, 21.01],
                                        [107.36, 21.02],
                                        [107.35, 21.02],
                                        [107.35, 21.01]
                                    ]
                                ]
                            }
                        }
                    ]
                }, null, 2),
                options: { raw: { language: 'json' } }
            },
            url: makeUrl('api/v1/forest-classification/ground-truth/zones/bulk'),
            description: 'Thêm danh sách hàng loạt vùng mẫu kiểm chứng dạng GeoJSON FeatureCollection (tối đa 500 vùng).'
        },
        event: testScript("pm.test('201 Created', () => pm.response.to.have.status(201));")
    },
    {
        name: 'Xóa vùng mẫu (Zone)',
        request: {
            method: 'DELETE',
            auth: bearerAuth('{{tnmtToken}}'),
            header: [],
            url: makeUrl('api/v1/forest-classification/ground-truth/zones/{{forestZoneId}}'),
            description: 'Vô hiệu hóa / xóa vùng mẫu kiểm chứng theo ID.'
        },
        event: testScript("pm.test('200 OK', () => pm.response.to.have.status(200));")
    },
    {
        name: 'Danh sách điểm mẫu (Points)',
        request: {
            method: 'GET',
            auth: bearerAuth('{{tnmtToken}}'),
            header: [],
            url: makeUrl('api/v1/forest-classification/ground-truth/points', [{ key: 'page', value: '1' }, { key: 'limit', value: '100' }]),
            description: 'Danh sách các điểm mẫu kiểm chứng thực địa (Ground Truth Points).'
        },
        event: testScript([
            "pm.test('200 OK', () => pm.response.to.have.status(200));",
            "const a = pm.response.json().data?.items || [];",
            "if (a[0]?.id) {",
            "    pm.collectionVariables.set('forestPointId', a[0].id);",
            "    pm.environment.set('forestPointId', a[0].id);",
            "}"
        ])
    },
    {
        name: 'Thêm điểm mẫu (Point)',
        request: {
            method: 'POST',
            auth: bearerAuth('{{tnmtToken}}'),
            header: [{ key: 'Content-Type', value: 'application/json' }],
            body: {
                mode: 'raw',
                raw: JSON.stringify({
                    lng: 107.356,
                    lat: 21.015,
                    observedAt: '2026-08-01T09:30:00.000Z',
                    classId: 1,
                    source: 'Mobile GIS khảo sát',
                    photoUrl: 'https://example.com/photos/gt_01.jpg',
                    reporterName: 'Nguyễn Văn A',
                    notes: 'Điểm kiểm chứng rừng phòng hộ'
                }, null, 2),
                options: { raw: { language: 'json' } }
            },
            url: makeUrl('api/v1/forest-classification/ground-truth/points'),
            description: 'Thêm một điểm mẫu kiểm chứng mới (lng 106..109, lat 20..22.5, classId 0..7).'
        },
        event: testScript([
            "pm.test('201 Created', () => pm.response.to.have.status(201));",
            "const d = pm.response.json().data;",
            "if (d?.id) {",
            "    pm.collectionVariables.set('forestPointId', d.id);",
            "    pm.environment.set('forestPointId', d.id);",
            "}"
        ])
    },
    {
        name: 'Thêm hàng loạt điểm mẫu (Bulk Points)',
        request: {
            method: 'POST',
            auth: bearerAuth('{{tnmtToken}}'),
            header: [{ key: 'Content-Type', value: 'application/json' }],
            body: {
                mode: 'raw',
                raw: JSON.stringify({
                    points: [
                        {
                            lng: 107.356,
                            lat: 21.015,
                            observedAt: '2026-08-01T09:30:00.000Z',
                            classId: 1,
                            source: 'Mobile GIS',
                            photoUrl: 'https://example.com/photos/gt_01.jpg',
                            reporterName: 'Nguyễn Văn A',
                            notes: 'Điểm 1'
                        },
                        {
                            lng: 107.362,
                            lat: 21.022,
                            observedAt: '2026-08-01T10:00:00.000Z',
                            classId: 2,
                            source: 'Mobile GIS',
                            reporterName: 'Trần Văn B',
                            notes: 'Điểm 2'
                        }
                    ]
                }, null, 2),
                options: { raw: { language: 'json' } }
            },
            url: makeUrl('api/v1/forest-classification/ground-truth/points/bulk'),
            description: 'Thêm danh sách hàng loạt điểm mẫu kiểm chứng (tối đa 1.000 điểm).'
        },
        event: testScript("pm.test('201 Created', () => pm.response.to.have.status(201));")
    },
    {
        name: 'Xóa điểm mẫu (Point)',
        request: {
            method: 'DELETE',
            auth: bearerAuth('{{tnmtToken}}'),
            header: [],
            url: makeUrl('api/v1/forest-classification/ground-truth/points/{{forestPointId}}'),
            description: 'Vô hiệu hóa / xóa điểm mẫu kiểm chứng theo ID.'
        },
        event: testScript("pm.test('200 OK', () => pm.response.to.have.status(200));")
    }
];

const forestClassificationFolder = {
    name: 'Phân loại đối tượng',
    description: 'API Phân loại đối tượng (lớp phủ / rừng) sử dụng Google Earth Engine, quản lý snapshot kết quả phân tích theo kỳ, công bố raster lên GeoServer / Web Map và quản lý dữ liệu kiểm chứng mặt đất (Ground Truth).',
    item: [
        {
            name: 'Công khai',
            description: 'Các API phân loại đối tượng tra cứu công khai (hoặc tùy chọn xác thực) cho người dùng và cộng đồng.',
            item: forestPublicItems
        },
        {
            name: 'Quản trị',
            description: 'Các API quản trị quy trình phân loại đối tượng: tra cứu toàn bộ lịch sử, yêu cầu chạy làm mới trên GEE và xuất bản raster (dùng tnmtToken hoặc adminToken).',
            item: forestAdminItems
        },
        {
            name: 'Dữ liệu kiểm chứng (Ground Truth)',
            description: 'Các API quản lý tập mẫu kiểm chứng thực địa (điểm và vùng đa giác) phục vụ huấn luyện và đánh giá độ chính xác phân loại.',
            item: forestGroundTruthItems
        }
    ]
};

// ─────────────────────────────────────────────────────────────────────────────
// 3. MERGE / UPDATE FOLDERS IN COLLECTION
// ─────────────────────────────────────────────────────────────────────────────

// Replace or add Ngập lụt folder
const floodIndex = coll.item.findIndex(i => i.name === 'Ngập lụt');
if (floodIndex >= 0) {
    coll.item[floodIndex] = floodFolder;
} else {
    coll.item.push(floodFolder);
}

// Replace or add Phân loại đối tượng folder
const forestIndex = coll.item.findIndex(i => i.name === 'Phân loại đối tượng');
if (forestIndex >= 0) {
    coll.item[forestIndex] = forestClassificationFolder;
} else {
    // Insert after Viễn thám or at end
    const vtIndex = coll.item.findIndex(i => i.name === 'Viễn thám');
    if (vtIndex >= 0) {
        coll.item.splice(vtIndex + 1, 0, forestClassificationFolder);
    } else {
        coll.item.push(forestClassificationFolder);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. UPDATE VARIABLES IN COLLECTION & ENVIRONMENT
// ─────────────────────────────────────────────────────────────────────────────

const requiredVariables = [
    { key: 'floodScenarioId', value: '1', description: 'ID kịch bản ngập úng dùng trong API flood' },
    { key: 'floodRunId', value: '1', description: 'ID lần chạy phân tích ngập lụt' },
    { key: 'floodArtifactId', value: '1', description: 'ID artifact kết quả ngập lụt' },
    { key: 'floodLegendCode', value: 'trend_frequency', description: 'Mã chú giải ngập lụt (ví dụ: trend_frequency, event_extent)' },
    { key: 'floodTrendConfigKey', value: 'handThresh', description: 'Khóa tham số cấu hình xu thế (ví dụ: handThresh, slopeThresh)' },
    { key: 'forestSnapshotId', value: '1', description: 'ID snapshot kết quả phân loại đối tượng' },
    { key: 'forestZoneId', value: '1', description: 'ID vùng mẫu kiểm chứng ground truth' },
    { key: 'forestPointId', value: '1', description: 'ID điểm mẫu kiểm chứng ground truth' }
];

// Add missing collection variables
requiredVariables.forEach(reqVar => {
    const existing = coll.variable.find(v => v.key === reqVar.key);
    if (!existing) {
        coll.variable.push({
            key: reqVar.key,
            value: reqVar.value,
            type: 'string',
            description: reqVar.description
        });
    }
});

// Add missing environment variables
requiredVariables.forEach(reqVar => {
    const existing = env.values.find(v => v.key === reqVar.key);
    if (!existing) {
        env.values.push({
            key: reqVar.key,
            value: reqVar.value,
            type: 'default',
            enabled: true,
            description: reqVar.description
        });
    }
});

fs.writeFileSync(collPath, JSON.stringify(coll, null, 2) + '\n', 'utf8');
fs.writeFileSync(envPath, JSON.stringify(env, null, 2) + '\n', 'utf8');

console.log('Update complete!');
console.log('Total collection folders:', coll.item.length);
console.log('Folders:', coll.item.map(i => i.name));
