'use strict';

const categoryRepository = require('../repositories/layer-category.repository');
const systemLogger = require('../utils/systemLogger.util');
const { Api403Error, Api409Error, Api422Error } = require('../core/error.response');

const hasPermission = (actor, action) => actor?.permissions?.layers?.[action] === true;
const assertPermission = (actor, action) => {
    if (!hasPermission(actor, action)) {
        throw new Api403Error('Không có quyền thực hiện thao tác lớp dữ liệu');
    }
};

const toCategorySlug = (value) => {
    if (!value || typeof value !== 'string' || !value.trim()) {
        return '';
    }
    const normalized = value
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/đ/g, 'd')
        .replace(/Đ/g, 'd')
        .toLowerCase()
        .replace(/[^a-z0-9_]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 50);
    if (!normalized) {
        return '';
    }
    return /^[a-z]/.test(normalized) ? normalized : `cat_${normalized}`;
};

const listCategories = async (actor) => {
    assertPermission(actor, 'read');
    return categoryRepository.list();
};

const createCategory = async (input, actor) => {
    assertPermission(actor, 'create');
    const nameVi = String(input?.name || '').trim();
    if (!nameVi || nameVi.length < 2 || nameVi.length > 120) {
        throw new Api422Error('Tên danh mục phải có độ dài từ 2 đến 120 ký tự', [
            'INVALID_CATEGORY_NAME',
        ]);
    }

    const existingByName = await categoryRepository.findByName(nameVi);
    if (existingByName) {
        throw new Api409Error('Tên danh mục đã tồn tại', ['CATEGORY_NAME_ALREADY_EXISTS']);
    }

    const key = toCategorySlug(nameVi);
    if (!key) {
        throw new Api422Error('Tên danh mục không thể tạo mã nhận diện hợp lệ', [
            'INVALID_CATEGORY_NAME',
        ]);
    }

    const existingByKey = await categoryRepository.findByKey(key);
    if (existingByKey) {
        throw new Api409Error('Mã danh mục tương ứng đã tồn tại', [
            'CATEGORY_KEY_ALREADY_EXISTS',
        ]);
    }

    try {
        const category = await categoryRepository.create({
            key,
            nameVi,
            createdBy: actor?.id || null,
        });

        systemLogger.logInfo('layers', 'layer_category_created', {
            actorId: actor?.id,
            role: actor?.role,
            orgId: actor?.orgId,
            key: category.key,
            nameVi: category.name,
        });

        return category;
    } catch (error) {
        if (error?.code === '23505') {
            throw new Api409Error('Danh mục đã tồn tại', ['CATEGORY_ALREADY_EXISTS']);
        }
        throw error;
    }
};

module.exports = {
    toCategorySlug,
    listCategories,
    createCategory,
};
