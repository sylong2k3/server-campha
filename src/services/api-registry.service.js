'use strict';
const repo = require('../repositories/api-registry.repository');
const webMap = require('../repositories/web-map.repository');
const { Api403Error, Api404Error, Api409Error, Api422Error } = require('../core/error.response');
const permission = (actor, action) => {
    if (actor?.permissions?.api_registry?.[action] !== true) {
        throw new Api403Error('Không có quyền quản trị API lớp dữ liệu');
    }
};
const tnmt = (actor) => {
    if (actor?.permissions?.api_registry?.grant !== true) {
        throw new Api403Error('Không có quyền phân quyền API', ['API_GRANT_PERMISSION_REQUIRED']);
    }
};
const hasWrite = (value) => value.some((x) => x !== 'GET' && x !== 'features:read');
const writeScope = { POST: 'features:create', PUT: 'features:update', DELETE: 'features:delete' };
const writeContract = (input) => {
    const methods = input.allowedMethods.filter((x) => x !== 'GET');
    if (
        (methods.length && !input.writeFields.length) ||
        (!methods.length && input.writeFields.length)
    ) {
        throw new Api422Error(
            'Phương thức ghi và danh sách trường ghi phải được cấu hình cùng nhau',
            ['REGISTRY_WRITE_CONTRACT'],
        );
    }
};
const fields = async (input, layer) => {
    const actual = new Set(await repo.columns(layer.table_name)),
        id = webMap.idFieldFor(layer),
        blocked = new Set([id.toLowerCase(), 'geom', 'source', 'target', 'cost', 'reverse_cost']);
    writeContract(input);
    const fieldsOnly = [...input.readFields, ...input.writeFields, ...input.searchFields];
    if (
        fieldsOnly.some(
            (x) => !webMap.FIELD.test(x) || !actual.has(x) || blocked.has(x.toLowerCase()),
        ) ||
        !webMap.FIELD.test(input.defaultSortField) ||
        !actual.has(input.defaultSortField)
    ) {
        throw new Api422Error('Cấu hình trường không hợp lệ', ['INVALID_REGISTRY_FIELD']);
    }
    if (
        input.readFields.includes(id) ||
        input.writeFields.some((x) => !input.readFields.includes(x)) ||
        input.searchFields.some((x) => !input.readFields.includes(x)) ||
        (!input.readFields.includes(input.defaultSortField) && input.defaultSortField !== id)
    ) {
        throw new Api422Error(
            'Trường ghi/tìm kiếm/sắp xếp phải thuộc trường đọc; ID được trả riêng',
            ['REGISTRY_FIELD_CONTRACT'],
        );
    }
    const display = new Set(webMap.configuredFields(layer)),
        editable = new Set(
            Array.isArray(layer.metadata?.editableFields) ? layer.metadata.editableFields : [],
        ),
        search = new Set(webMap.searchFields(layer));
    if (
        input.readFields.some((x) => !display.has(x)) ||
        input.writeFields.some((x) => !editable.has(x)) ||
        input.searchFields.some((x) => !search.has(x))
    ) {
        throw new Api422Error('Cấu hình vượt allowlist metadata của lớp', [
            'REGISTRY_EXCEEDS_LAYER_METADATA',
        ]);
    }
};
const registry = async (id) => {
    const row = await repo.find(id);
    if (!row) {
        throw new Api404Error('Không tìm thấy API lớp dữ liệu');
    }
    return row;
};
const list = async (filter, actor) => {
    permission(actor, 'read');
    return repo.list(filter);
};
const get = async (id, actor) => {
    permission(actor, 'read');
    return registry(id);
};
const create = async (input, actor) => {
    permission(actor, 'create');
    if (hasWrite(input.allowedMethods) || input.writeFields.length) {
        tnmt(actor);
    }
    const layer = await repo.layer(input.layerId);
    if (
        !layer ||
        layer.storage_kind !== 'postgis' ||
        !layer.table_name ||
        layer.publish_status !== 'published'
    ) {
        throw new Api422Error('Chỉ lớp PostGIS đã publish được đăng ký API', [
            'LAYER_NOT_SHAREABLE',
        ]);
    }
    await fields(input, layer);
    try {
        return await repo.create(input, actor);
    } catch (error) {
        if (error.code === '23505') {
            throw new Api409Error('Lớp hoặc slug đã được đăng ký', ['REGISTRY_CONFLICT']);
        }
        throw error;
    }
};
const update = async (id, input, actor) => {
    permission(actor, 'create');
    const current = await registry(id),
        merged = {
            readFields: input.readFields || current.read_fields,
            writeFields: input.writeFields || current.write_fields,
            searchFields: input.searchFields || current.search_fields,
            allowedMethods: input.allowedMethods || current.allowed_methods,
            defaultSortField: input.defaultSortField || current.default_sort_field,
        };
    const touchesWrite =
        Object.hasOwn(input, 'writeFields') || Object.hasOwn(input, 'allowedMethods');
    if (
        touchesWrite &&
        (hasWrite(current.allowed_methods) ||
            hasWrite(merged.allowedMethods) ||
            current.write_fields.length ||
            merged.writeFields.length)
    ) {
        tnmt(actor);
    }
    await fields(merged, current);
    const row = await repo.update(id, input, actor);
    if (!row) {
        throw new Api409Error('API đã thay đổi; tải lại trước khi cập nhật', [
            'OPTIMISTIC_LOCK_CONFLICT',
        ]);
    }
    return row;
};
const remove = async (id, version, actor) => {
    permission(actor, 'create');
    const row = await repo.remove(id, version, actor);
    if (!row) {
        if (!(await repo.find(id))) {
            throw new Api404Error('Không tìm thấy API lớp dữ liệu');
        }
        throw new Api409Error('API đã thay đổi; tải lại trước khi xóa', [
            'OPTIMISTIC_LOCK_CONFLICT',
        ]);
    }
    return row;
};
const listKeys = async (id, actor) => {
    permission(actor, 'read');
    await registry(id);
    return repo.keys(id);
};
const issue = async (id, input, actor) => {
    permission(actor, 'share');
    const current = await registry(id);
    if (!current.is_active) {
        throw new Api422Error('API đang bị vô hiệu hóa', ['REGISTRY_DISABLED']);
    }
    if (input.scopes.some((x) => x !== 'features:read')) {
        tnmt(actor);
        const enabled = new Set(current.allowed_methods.map((x) => writeScope[x]).filter(Boolean));
        if (input.scopes.some((x) => x !== 'features:read' && !enabled.has(x))) {
            throw new Api422Error('Scope vượt phương thức registry', ['SCOPE_EXCEEDS_REGISTRY']);
        }
    }
    return repo.issue(current, input, actor);
};
const revoke = async (id, actor) => {
    permission(actor, 'share');
    const current = await repo.key(id);
    if (!current) {
        throw new Api404Error('Không tìm thấy khóa chia sẻ');
    }
    if (current.scopes.some((x) => x !== 'features:read')) {
        tnmt(actor);
    }
    const row = await repo.revoke(id, actor);
    if (!row) {
        throw new Api409Error('Khóa đã được thu hồi', ['KEY_ALREADY_REVOKED']);
    }
    return row;
};
const rotate = async (id, input, actor) => {
    permission(actor, 'share');
    const current = await repo.key(id);
    if (!current) {
        throw new Api404Error('Không tìm thấy khóa chia sẻ');
    }
    if (current.revoked_at) {
        throw new Api409Error('Khóa đã được thu hồi; hãy cấp khóa mới', ['KEY_REVOKED']);
    }
    if (current.scopes.some((x) => x !== 'features:read')) {
        tnmt(actor);
    }
    return repo.rotate(current, input.expiresInHours, actor);
};
const usage = async (id, input, actor) => {
    permission(actor, 'read');
    await registry(id);
    return repo.usage(id, input.from, input.to);
};
module.exports = {
    list,
    get,
    create,
    update,
    remove,
    listKeys,
    issue,
    revoke,
    rotate,
    usage,
    permission,
    tnmt,
    fields,
};
