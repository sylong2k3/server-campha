'use strict';

jest.mock('../../repositories/layer.repository');
jest.mock('../../repositories/layer-job.repository');
jest.mock('../../utils/systemLogger.util', () => ({ logInfo: jest.fn() }));
jest.mock('../../utils/geoserver.client', () => ({ publishVectorLayer: jest.fn() }));

const layerRepository = require('../../repositories/layer.repository');
const jobRepository = require('../../repositories/layer-job.repository');
const service = require('../layer.service');

const actor = {
    id: 7, role: 'so_tnmt', orgId: 3,
    permissions: { layers: { create: true, read: true, update: true, delete: true, grant: true } },
};

describe('layer service', () => {
    beforeEach(() => jest.clearAllMocks());

    test('allows RBAC read but rejects non-TNMT mutation even if token claims it', async () => {
        layerRepository.list.mockResolvedValue({ items: [], total: 0 });
        await expect(service.listLayers({ page: 1, limit: 20 }, {
            ...actor, role: 'system_admin', permissions: { layers: { read: true, update: true } },
        })).resolves.toEqual({ items: [], total: 0 });
        await expect(service.updateLayer(1, { expectedUpdatedAt: new Date(), nameVi: 'Tên mới' }, {
            ...actor, role: 'system_admin', permissions: { layers: { update: true } },
        })).rejects.toMatchObject({ status: 403 });
    });

    test('enqueue requires a ready clean owner file', async () => {
        jobRepository.createImport.mockResolvedValue(null);
        await expect(service.enqueueImport('shapefile', { fileObjectId: 1, code: 'layer_a' }, actor))
            .rejects.toMatchObject({ status: 422, errors: ['SOURCE_FILE_NOT_READY'] });
    });

    test('update returns optimistic conflict when record exists but timestamp changed', async () => {
        layerRepository.updateMetadata.mockResolvedValue(null);
        layerRepository.findById.mockResolvedValue({ id: 1 });
        await expect(service.updateLayer(1, { expectedUpdatedAt: new Date(), nameVi: 'Tên mới' }, actor))
            .rejects.toMatchObject({ status: 409, errors: ['OPTIMISTIC_LOCK_CONFLICT'] });
    });

    test('ACL cannot grant edit/delete outside TNMT role contract', async () => {
        layerRepository.activeRoleCodes.mockResolvedValue(['citizen']);
        await expect(service.replacePermissions(1, { permissions: [{
            roleCode: 'citizen', canView: true, canExport: false, canEdit: true, canDelete: false,
        }] }, actor)).rejects.toMatchObject({ status: 422, errors: ['ACL_EXCEEDS_ROLE_CONTRACT'] });
    });

    test('valid ACL replacement and soft-delete return repository result', async () => {
        const permissions = [{ roleCode: 'citizen', canView: true, canExport: false, canEdit: false, canDelete: false }];
        layerRepository.activeRoleCodes.mockResolvedValue(['citizen']);
        layerRepository.replacePermissions.mockResolvedValue({ id: 1, permissions });
        await expect(service.replacePermissions(1, { permissions }, actor)).resolves.toMatchObject({ id: 1 });
        layerRepository.softDeleteAndEnqueue.mockResolvedValue({ id: 1, cleanup_status: 'queued' });
        await expect(service.deleteLayer(1, new Date(), actor)).resolves.toEqual({ id: 1, cleanupStatus: 'queued' });
    });
});
