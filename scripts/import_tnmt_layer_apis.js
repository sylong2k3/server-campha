'use strict';

/**
 * Tạo dữ liệu API lớp bản đồ (`apikey.registries`, endpoint /admin/api-registry)
 * qua REST API bằng tài khoản Sở Tài nguyên và Môi trường (role `so_tnmt`).
 *
 * Luồng cho mỗi lớp trong TARGETS:
 *   1. POST /auth/login                     — accessToken của tnmt@campha.gov.vn
 *   2. GET  /admin/layers                   — tìm lớp theo `code`
 *   3. GET  /maps/layers/{id}/wfs           — dò tên cột thật của lớp (GetFeature count=1)
 *   4. PATCH /admin/layers/{id}             — bổ sung metadata.displayFields / searchFields
 *                                             (JSONB merge, chỉ chạy khi displayFields còn rỗng)
 *   5. POST /admin/api-registry             — tạo API lớp (chỉ GET, không cấu hình trường ghi)
 *
 * Script chỉ THÊM: lớp nào đã có displayFields thì giữ nguyên, lớp nào đã có API thì bỏ qua.
 * Không phát hành API key — dùng POST /admin/api-registry/{id}/keys khi cần.
 *
 * Chạy:
 *   node scripts/import_tnmt_layer_apis.js            # tạo thật
 *   node scripts/import_tnmt_layer_apis.js --dry-run  # chỉ in kế hoạch, không ghi
 */

require('dotenv').config();

const API_BASE = (
    process.env.API_REMOTE_URL || 'https://apicampha.tourismpj.pro.vn/api/v1'
).replace(/\/+$/, '');
const TNMT_EMAIL = process.env.TNMT_EMAIL || 'tnmt@campha.gov.vn';
const TNMT_PASSWORD = process.env.TNMT_PASSWORD || 'CamPha@2026';
const DRY_RUN = process.argv.includes('--dry-run');

/** Các lớp vector nghiệp vụ được mở API, tra theo `code` để không phụ thuộc id môi trường. */
const TARGETS = [
    {
        code: 'ranhgioi_campha',
        slug: 'ranh-gioi-campha',
        name: 'API ranh giới hành chính TP. Cẩm Phả',
    },
    {
        code: 'ranh_gioi_khu_vuc',
        slug: 'ranh-gioi-khu-vuc',
        name: 'API ranh giới khu vực hành chính',
    },
    { code: 'dia_danh', slug: 'dia-danh', name: 'API địa danh TP. Cẩm Phả' },
    { code: 'giao_thong', slug: 'giao-thong', name: 'API mạng lưới giao thông' },
    { code: 'thuy_he_20260526', slug: 'thuy-he', name: 'API thủy hệ TP. Cẩm Phả' },
    { code: 'tn_ho_ga', slug: 'tn-ho-ga', name: 'API hố ga hệ thống thoát nước' },
    { code: 'tn_tram_bom', slug: 'tn-tram-bom', name: 'API trạm bơm hệ thống thoát nước' },
];

/** Cột hạ tầng không được đưa vào hợp đồng API (khớp allowlist phía server). */
const BLOCKED_FIELDS = new Set(['geom', 'source', 'target', 'cost', 'reverse_cost']);
const FIELD_PATTERN = /^[A-Za-z_][A-Za-z0-9_]{0,62}$/;
/** Ưu tiên làm trường tìm kiếm / sắp xếp mặc định nếu lớp có. */
const NAME_HINTS = ['ten', 'name', 'nhan', 'label', 'dia_danh', 'tentin', 'tenx'];

// ---------------------------------------------------------------------------
//  HTTP helper
// ---------------------------------------------------------------------------
const call = async (path, options = {}) => {
    const response = await fetch(`${API_BASE}${path}`, options);
    const raw = await response.text();
    let body;
    try {
        body = raw ? JSON.parse(raw) : {};
    } catch {
        body = { raw };
    }
    return { httpStatus: response.status, body };
};

const login = async () => {
    const { httpStatus, body } = await call('/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: TNMT_EMAIL, password: TNMT_PASSWORD }),
    });
    const token = body?.data?.accessToken;
    if (!token) {
        throw new Error(`Đăng nhập thất bại (HTTP ${httpStatus}): ${JSON.stringify(body)}`);
    }
    return { token, user: body.data.user || {} };
};

const listLayers = async (auth) => {
    const { httpStatus, body } = await call('/admin/layers?limit=100', { headers: auth });
    if (httpStatus !== 200) {
        throw new Error(`Không đọc được danh sách lớp (HTTP ${httpStatus}): ${JSON.stringify(body)}`);
    }
    return body?.data?.items || [];
};

const listRegistries = async (auth) => {
    const { httpStatus, body } = await call('/admin/api-registry?limit=100', { headers: auth });
    if (httpStatus !== 200) {
        throw new Error(`Không đọc được danh sách API lớp (HTTP ${httpStatus}): ${JSON.stringify(body)}`);
    }
    return body?.data?.items || [];
};

/** Dò tên cột thật của lớp qua WFS GetFeature (1 đối tượng). */
const discoverColumns = async (auth, layerId) => {
    const { httpStatus, body } = await call(
        `/maps/layers/${layerId}/wfs?request=GetFeature&count=1`,
        { headers: auth },
    );
    if (httpStatus !== 200) {
        throw new Error(`Không dò được cột qua WFS (HTTP ${httpStatus}): ${JSON.stringify(body).slice(0, 200)}`);
    }
    const properties = body?.features?.[0]?.properties;
    if (!properties) {
        throw new Error('Lớp chưa có đối tượng nào để dò cấu trúc cột');
    }
    return properties;
};

const patchLayerMetadata = async (auth, layer, metadata) => {
    const { httpStatus, body } = await call(`/admin/layers/${layer.id}`, {
        method: 'PATCH',
        headers: { ...auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({ expectedUpdatedAt: layer.updated_at, metadata }),
    });
    if (httpStatus !== 200) {
        throw new Error(`Cập nhật metadata lớp thất bại (HTTP ${httpStatus}): ${JSON.stringify(body)}`);
    }
    return body.data;
};

const createRegistry = async (auth, payload) => {
    const { httpStatus, body } = await call('/admin/api-registry', {
        method: 'POST',
        headers: { ...auth, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    });
    if (httpStatus !== 201) {
        throw new Error(`Tạo API lớp thất bại (HTTP ${httpStatus}): ${JSON.stringify(body)}`);
    }
    return body.data;
};

// ---------------------------------------------------------------------------
//  Suy luận cấu hình trường
// ---------------------------------------------------------------------------
const idFieldFor = (layer) => {
    const configured = layer.metadata?.idField;
    if (typeof configured === 'string' && FIELD_PATTERN.test(configured)) {
        return configured;
    }
    return layer.metadata?.importType === 'excel' ? 'source_row' : 'source_fid';
};

const looksLikeName = (field) => NAME_HINTS.some((hint) => field.toLowerCase().includes(hint));

/** Trả về { displayFields, searchFields } suy ra từ cột thật của lớp. */
const deriveFields = (properties, idField) => {
    const usable = Object.keys(properties).filter(
        (field) =>
            FIELD_PATTERN.test(field) &&
            !BLOCKED_FIELDS.has(field.toLowerCase()) &&
            field.toLowerCase() !== idField.toLowerCase() &&
            field.toLowerCase() !== 'source_fid' &&
            field.toLowerCase() !== 'source_row',
    );
    const displayFields = usable.slice(0, 50);
    // Chỉ cột kiểu chuỗi mới có nghĩa khi tìm kiếm toàn văn; ưu tiên cột tên,
    // nếu lớp không có cột tên nào thì lấy tối đa 3 cột chuỗi đầu tiên.
    const textFields = displayFields.filter((field) => typeof properties[field] === 'string');
    const named = textFields.filter(looksLikeName);
    const searchFields = (named.length ? named : textFields.slice(0, 3)).slice(0, 10);
    return { displayFields, searchFields };
};

const pickSortField = (displayFields) =>
    displayFields.find(looksLikeName) || displayFields[0] || null;

// ---------------------------------------------------------------------------
//  Main
// ---------------------------------------------------------------------------
async function main() {
    console.log('=== TẠO API LỚP BẢN ĐỒ QUA ROLE SỞ TÀI NGUYÊN VÀ MÔI TRƯỜNG ===');
    console.log(`API       : ${API_BASE}`);
    console.log(`Tài khoản : ${TNMT_EMAIL}`);
    console.log(`Chế độ    : ${DRY_RUN ? 'DRY-RUN (không ghi dữ liệu)' : 'GHI DỮ LIỆU THẬT'}\n`);

    console.log('1. Đăng nhập...');
    const { token, user } = await login();
    const auth = { Authorization: `Bearer ${token}` };
    const roleCode = user.role?.code || user.role_code || user.role || 'n/a';
    console.log(` -> OK. role = ${roleCode}\n`);

    console.log('2. Đọc danh sách lớp và API lớp hiện có...');
    const layers = await listLayers(auth);
    const registries = await listRegistries(auth);
    const layerByCode = new Map(layers.map((l) => [l.code, l]));
    const registeredLayerIds = new Set(registries.map((r) => String(r.layer_id ?? r.layerId)));
    const usedSlugs = new Set(registries.map((r) => r.slug));
    console.log(` -> ${layers.length} lớp, ${registries.length} API lớp đang tồn tại.\n`);

    console.log('3. Xử lý từng lớp mục tiêu...\n');
    const created = [];
    const patched = [];
    const skipped = [];
    const failed = [];

    for (const target of TARGETS) {
        const label = `[${target.code}]`;
        const layer = layerByCode.get(target.code);
        if (!layer) {
            console.log(`${label} BỎ QUA — không tìm thấy lớp trên hệ thống.`);
            skipped.push({ code: target.code, reason: 'không tìm thấy lớp' });
            continue;
        }
        if (registeredLayerIds.has(String(layer.id))) {
            console.log(`${label} BỎ QUA — lớp đã có API lớp.`);
            skipped.push({ code: target.code, reason: 'đã có API lớp' });
            continue;
        }
        if (usedSlugs.has(target.slug)) {
            console.log(`${label} BỎ QUA — slug "${target.slug}" đã được dùng.`);
            skipped.push({ code: target.code, reason: `slug ${target.slug} đã dùng` });
            continue;
        }

        try {
            const idField = idFieldFor(layer);
            let current = layer;
            let displayFields = Array.isArray(layer.metadata?.displayFields)
                ? layer.metadata.displayFields.filter((f) => FIELD_PATTERN.test(f))
                : [];
            let searchFields = Array.isArray(layer.metadata?.searchFields)
                ? layer.metadata.searchFields.filter((f) => FIELD_PATTERN.test(f))
                : [];

            if (!displayFields.length) {
                const properties = await discoverColumns(auth, layer.id);
                const derived = deriveFields(properties, idField);
                if (!derived.displayFields.length) {
                    throw new Error('Lớp không có cột thuộc tính nào dùng được');
                }
                displayFields = derived.displayFields;
                searchFields = derived.searchFields;
                console.log(
                    `${label} bổ sung metadata: display=[${displayFields.join(', ')}] search=[${searchFields.join(', ')}]`,
                );
                if (!DRY_RUN) {
                    current = await patchLayerMetadata(auth, layer, { displayFields, searchFields });
                    patched.push(target.code);
                }
            } else {
                console.log(`${label} giữ nguyên metadata sẵn có: display=[${displayFields.join(', ')}]`);
            }

            const readFields = displayFields.filter((f) => f !== idField);
            const registrySearchFields = searchFields.filter((f) => readFields.includes(f));
            const defaultSortField = pickSortField(readFields);
            if (!defaultSortField) {
                throw new Error('Không xác định được trường sắp xếp mặc định');
            }
            const payload = {
                layerId: Number(current.id),
                slug: target.slug,
                name: target.name,
                readFields,
                writeFields: [],
                searchFields: registrySearchFields,
                allowedMethods: ['GET'],
                defaultSortField,
            };

            if (DRY_RUN) {
                console.log(`${label} sẽ tạo API: ${JSON.stringify(payload)}\n`);
                continue;
            }
            const row = await createRegistry(auth, payload);
            usedSlugs.add(target.slug);
            registeredLayerIds.add(String(current.id));
            console.log(`${label} -> OK. registryId=${row.id}, slug=${row.slug}\n`);
            created.push(row);
        } catch (error) {
            console.error(`${label} -> LỖI: ${error.message}\n`);
            failed.push({ code: target.code, error: error.message });
        }
    }

    console.log('=== KẾT QUẢ ===');
    console.log(`  API lớp tạo mới     : ${created.length}`);
    console.log(`  Lớp được bổ sung metadata: ${patched.length}${patched.length ? ` (${patched.join(', ')})` : ''}`);
    console.log(`  Bỏ qua              : ${skipped.length}`);
    skipped.forEach((s) => console.log(`    - ${s.code}: ${s.reason}`));
    console.log(`  Thất bại            : ${failed.length}`);
    failed.forEach((f) => console.log(`    - ${f.code}: ${f.error}`));

    if (!DRY_RUN) {
        const final = await listRegistries(auth);
        console.log(`\n  Tổng API lớp hiện có: ${final.length}`);
        final.forEach((r) =>
            console.log(`    [ID ${r.id}] ${r.slug} — ${r.name} (layer ${r.layer_id ?? r.layerId})`),
        );
    }
}

main().catch((error) => {
    console.error('LỖI KHÔNG MONG MUỐN:', error);
    process.exit(1);
});
