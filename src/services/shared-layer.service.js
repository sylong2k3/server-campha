'use strict';
const repo = require('../repositories/shared-layer.repository');
const webMap = require('../repositories/web-map.repository');
const { Api404Error, Api409Error, Api422Error } = require('../core/error.response');
const context = (share, slug) => {
    if (share.slug !== slug) {
        throw new Api404Error('Không tìm thấy API lớp dữ liệu');
    }
    return {
        ...share,
        api_key_id: share.id,
        id: share.layer_id,
        registry_id: share.registry_id,
        layer_id: share.layer_id,
    };
};
const keys = (input, allowed) => {
    const names = Object.keys(input.attributes || {});
    if (names.some((x) => !allowed.includes(x))) {
        throw new Api422Error('Thuộc tính không được phép ghi', ['SHARED_FIELD_FORBIDDEN']);
    }
};
const mapError = (error) => {
    if (error.code === '23505') {
        throw new Api409Error('Mã đối tượng đã tồn tại hoặc từng được sử dụng', [
            'FEATURE_ID_CONFLICT',
        ]);
    }
    if (['INVALID_FEATURE_GEOMETRY'].includes(error.code) || error.code?.startsWith('22')) {
        throw new Api422Error('Dữ liệu đối tượng không hợp lệ', [error.code || 'INVALID_FEATURE']);
    }
    throw error;
};
const list = async (slug, input, share) => {
    const r = context(share, slug),
        sort = input.sortBy || r.default_sort_field,
        id = webMap.idFieldFor(r);
    if (sort !== id && !r.read_fields.includes(sort)) {
        throw new Api422Error('Trường sắp xếp không được phép', ['SORT_FIELD_FORBIDDEN']);
    }
    if (input.q && !r.search_fields.length) {
        throw new Api422Error('API không cấu hình trường tìm kiếm', ['SEARCH_NOT_CONFIGURED']);
    }
    return repo.list(r, input);
};
const get = async (slug, featureId, share) => {
    const row = await repo.get(context(share, slug), featureId);
    if (!row) {
        throw new Api404Error('Không tìm thấy đối tượng');
    }
    return row;
};
const create = async (slug, input, share) => {
    const r = context(share, slug);
    keys(input, r.write_fields);
    try {
        return await repo.create(r, input, { id: r.created_by });
    } catch (error) {
        return mapError(error);
    }
};
const update = async (slug, featureId, input, share) => {
    const r = context(share, slug);
    keys(input, r.write_fields);
    try {
        const result = await repo.update(r, featureId, input, {
            id: r.created_by,
            ipAddress: null,
            userAgent: 'shared-api',
        });
        if (result.missing) {
            throw new Api404Error('Không tìm thấy đối tượng');
        }
        if (result.conflict) {
            throw new Api409Error('Đối tượng đã thay đổi; tải lại trước khi sửa', [
                'FEATURE_VERSION_CONFLICT',
            ]);
        }
        return result;
    } catch (error) {
        return mapError(error);
    }
};
const remove = async (slug, featureId, input, share) => {
    try {
        const result = await repo.remove(context(share, slug), featureId, input.baseVersion, {
            id: share.created_by,
        });
        if (result.missing) {
            throw new Api404Error('Không tìm thấy đối tượng');
        }
        if (result.conflict) {
            throw new Api409Error('Đối tượng đã thay đổi; tải lại trước khi xóa', [
                'FEATURE_VERSION_CONFLICT',
            ]);
        }
        return result;
    } catch (error) {
        return mapError(error);
    }
};
module.exports = { list, get, create, update, remove, keys, context };
