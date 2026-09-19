'use strict';

jest.mock('../../repositories/layer-category.repository');
jest.mock('../../utils/systemLogger.util', () => ({
    logInfo: jest.fn(),
}));

const categoryRepository = require('../../repositories/layer-category.repository');
const systemLogger = require('../../utils/systemLogger.util');
const service = require('../layer-category.service');

const actor = {
    id: 9,
    role: 'so_tnmt',
    orgId: 2,
    permissions: {
        layers: {
            create: true,
            read: true,
            update: true,
            delete: true,
        },
    },
};

describe('layer-category service', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('toCategorySlug converts Vietnamese with accents to valid ascii slug', () => {
        expect(service.toCategorySlug('Quy hoạch sử dụng đất')).toBe('quy_hoach_su_dung_dat');
        expect(service.toCategorySlug('Đô thị & Hạ tầng')).toBe('do_thi_ha_tang');
        expect(service.toCategorySlug('123 Thử Nghiệm')).toBe('cat_123_thu_nghiem');
        expect(service.toCategorySlug('')).toBe('');
    });

    test('listCategories enforces layers.read permission', async () => {
        await expect(
            service.listCategories({ ...actor, permissions: { layers: { read: false } } }),
        ).rejects.toMatchObject({ status: 403 });

        categoryRepository.list.mockResolvedValueOnce([{ key: 'flood', name: 'Ngập lụt' }]);
        const result = await service.listCategories(actor);
        expect(result).toEqual([{ key: 'flood', name: 'Ngập lụt' }]);
        expect(categoryRepository.list).toHaveBeenCalledWith({ search: '' });
    });

    test('listCategories passes search option to repository', async () => {
        categoryRepository.list.mockResolvedValueOnce([{ key: 'flood', name: 'Ngập lụt' }]);
        const result = await service.listCategories({ search: 'ngap' }, actor);
        expect(result).toEqual([{ key: 'flood', name: 'Ngập lụt' }]);
        expect(categoryRepository.list).toHaveBeenCalledWith({ search: 'ngap' });
    });

    test('createCategory enforces layers.create permission', async () => {
        await expect(
            service.createCategory(
                { name: 'Đất nông nghiệp' },
                { ...actor, permissions: { layers: { create: false } } },
            ),
        ).rejects.toMatchObject({ status: 403 });
    });

    test('createCategory validates name length', async () => {
        await expect(
            service.createCategory({ name: ' ' }, actor),
        ).rejects.toMatchObject({ status: 422, errors: ['INVALID_CATEGORY_NAME'] });

        await expect(
            service.createCategory({ name: 'A' }, actor),
        ).rejects.toMatchObject({ status: 422, errors: ['INVALID_CATEGORY_NAME'] });

        await expect(
            service.createCategory({ name: 'x'.repeat(121) }, actor),
        ).rejects.toMatchObject({ status: 422, errors: ['INVALID_CATEGORY_NAME'] });
    });

    test('createCategory detects duplicate category name', async () => {
        categoryRepository.findByName.mockResolvedValueOnce({
            id: 1,
            key: 'giao_thong',
            name: 'Giao thông',
        });

        await expect(
            service.createCategory({ name: 'Giao thông' }, actor),
        ).rejects.toMatchObject({
            status: 409,
            errors: ['CATEGORY_NAME_ALREADY_EXISTS'],
        });
    });

    test('createCategory detects duplicate generated category key', async () => {
        categoryRepository.findByName.mockResolvedValueOnce(null);
        categoryRepository.findByKey.mockResolvedValueOnce({
            id: 2,
            key: 'giao_thong',
            name: 'Giao thông cũ',
        });

        await expect(
            service.createCategory({ name: 'Giao Thông' }, actor),
        ).rejects.toMatchObject({
            status: 409,
            errors: ['CATEGORY_KEY_ALREADY_EXISTS'],
        });
    });

    test('createCategory successfully persists and logs audit', async () => {
        categoryRepository.findByName.mockResolvedValueOnce(null);
        categoryRepository.findByKey.mockResolvedValueOnce(null);
        categoryRepository.create.mockResolvedValueOnce({
            id: 10,
            key: 'ngap_ven_bien',
            name: 'Ngập ven biển',
            createdAt: new Date(),
            updatedAt: new Date(),
        });

        const created = await service.createCategory({ name: 'Ngập ven biển' }, actor);
        expect(created).toMatchObject({
            id: 10,
            key: 'ngap_ven_bien',
            name: 'Ngập ven biển',
        });
        expect(categoryRepository.create).toHaveBeenCalledWith({
            key: 'ngap_ven_bien',
            nameVi: 'Ngập ven biển',
            createdBy: 9,
        });
        expect(systemLogger.logInfo).toHaveBeenCalledWith(
            'layers',
            'layer_category_created',
            expect.objectContaining({
                actorId: 9,
                key: 'ngap_ven_bien',
                nameVi: 'Ngập ven biển',
            }),
        );
    });

    test('createCategory catches unique violation error code 23505', async () => {
        categoryRepository.findByName.mockResolvedValueOnce(null);
        categoryRepository.findByKey.mockResolvedValueOnce(null);
        const duplicateErr = new Error('duplicate key');
        duplicateErr.code = '23505';
        categoryRepository.create.mockRejectedValueOnce(duplicateErr);

        await expect(
            service.createCategory({ name: 'Quy hoạch biển' }, actor),
        ).rejects.toMatchObject({
            status: 409,
            errors: ['CATEGORY_ALREADY_EXISTS'],
        });
    });

    test('deleteCategory enforces layers.delete permission', async () => {
        await expect(
            service.deleteCategory('custom_cat', {
                ...actor,
                permissions: { layers: { delete: false } },
            }),
        ).rejects.toMatchObject({ status: 403 });
    });

    test('deleteCategory protects system default categories', async () => {
        await expect(service.deleteCategory('flood', actor)).rejects.toMatchObject({
            status: 422,
            errors: ['SYSTEM_CATEGORY_IMMUTABLE'],
        });
        await expect(service.deleteCategory('land_cover', actor)).rejects.toMatchObject({
            status: 422,
            errors: ['SYSTEM_CATEGORY_IMMUTABLE'],
        });
    });

    test('deleteCategory checks existence of category', async () => {
        categoryRepository.findByKey.mockResolvedValueOnce(null);

        await expect(service.deleteCategory('non_existent', actor)).rejects.toMatchObject({
            status: 404,
        });
    });

    test('deleteCategory blocks deletion if active layers exist', async () => {
        categoryRepository.findByKey.mockResolvedValueOnce({
            id: 20,
            key: 'du_lich',
            name: 'Du lịch',
        });
        categoryRepository.countActiveLayers.mockResolvedValueOnce(3);

        await expect(service.deleteCategory('du_lich', actor)).rejects.toMatchObject({
            status: 409,
            errors: ['CATEGORY_IN_USE'],
        });
    });

    test('deleteCategory successfully deletes unused category', async () => {
        categoryRepository.findByKey.mockResolvedValueOnce({
            id: 20,
            key: 'du_lich_cu',
            name: 'Du lịch cũ',
        });
        categoryRepository.countActiveLayers.mockResolvedValueOnce(0);
        categoryRepository.deleteByKey.mockResolvedValueOnce({
            id: 20,
            key: 'du_lich_cu',
            name: 'Du lịch cũ',
        });

        const res = await service.deleteCategory('du_lich_cu', actor);
        expect(res).toEqual({ key: 'du_lich_cu', name: 'Du lịch cũ' });
        expect(categoryRepository.deleteByKey).toHaveBeenCalledWith('du_lich_cu');
        expect(systemLogger.logInfo).toHaveBeenCalledWith(
            'layers',
            'layer_category_deleted',
            expect.objectContaining({
                actorId: 9,
                key: 'du_lich_cu',
                nameVi: 'Du lịch cũ',
            }),
        );
    });
});
