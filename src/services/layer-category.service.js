'use strict';

const categoryRepository = require('../repositories/layer-category.repository');
const systemLogger = require('../utils/systemLogger.util');
const { Api403Error, Api404Error, Api409Error, Api422Error } = require('../core/error.response');

const SYSTEM_CATEGORY_KEYS = new Set([
    'land_cover',
    'flood',
    'remote_sensing',
    'forest_district',
    'hanh_chinh',
    'thuy_van',
    'giao_thong',
    'other',
]);

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

const deleteCategory = async (key, actor) => {
    assertPermission(actor, 'delete');
    const safeKey = String(key || '').trim();
    if (!safeKey) {
        throw new Api422Error('Mã danh mục không hợp lệ', ['INVALID_CATEGORY_KEY']);
    }

    if (SYSTEM_CATEGORY_KEYS.has(safeKey)) {
        throw new Api422Error('Không thể xóa danh mục mặc định của hệ thống', [
            'SYSTEM_CATEGORY_IMMUTABLE',
        ]);
    }

    const existing = await categoryRepository.findByKey(safeKey);
    if (!existing) {
        throw new Api404Error('Không tìm thấy danh mục');
    }

    const activeLayersCount = await categoryRepository.countActiveLayers(safeKey);
    if (activeLayersCount > 0) {
        throw new Api409Error(
            `Danh mục đang được sử dụng bởi ${activeLayersCount} lớp bản đồ, không thể xóa`,
            ['CATEGORY_IN_USE'],
        );
    }

    await categoryRepository.deleteByKey(safeKey);

    systemLogger.logInfo('layers', 'layer_category_deleted', {
        actorId: actor?.id,
        role: actor?.role,
        orgId: actor?.orgId,
        key: safeKey,
        nameVi: existing.name,
    });

    return { key: safeKey, name: existing.name };
};

module.exports = {
    toCategorySlug,
    listCategories,
    createCategory,
    deleteCategory,
};
