'use strict';

jest.mock('../../repositories/web-map.repository');
jest.mock('../minio.service');
const repository = require('../../repositories/web-map.repository');
const minioService = require('../minio.service');
const service = require('../web-map.service');

const actor = {
    role: 'citizen',
    lang: 'vi',
    permissions: {
        map: {
            view: true,
            view_attributes: true,
            search_feature: true,
            view_legend: true,
            view_3d: true,
        },
    },
};
const layer = {
    id: 1,
    code: 'phuong',
    name_vi: 'Phường',
    category: 'administrative',
    category_name: 'Ranh giới hành chính',
    storage_kind: 'postgis',
    table_name: 'layer_1',
    style_name: 'style',
    min_zoom: 8,
    max_zoom: 18,
    legend_config: { type: 'single' },
    is_enable_default: true,
    metadata: {
        searchFields: ['ten'],
        displayFields: ['ten'],
        idField: 'source_fid',
        editableFields: ['ten', 'geom', 'source_fid', 'ten'],
    },
    role_can_edit: true,
};

describe('web map service', () => {
    beforeEach(() => jest.clearAllMocks());

    test('anonymous lists public catalog but authenticated permission is enforced', async () => {
        repository.catalog.mockResolvedValue([layer]);
        const anonymous = await service.listLayers(undefined, null);
        expect(anonymous).toEqual([
            expect.objectContaining({ id: 1, code: 'phuong', nameVi: 'Phường' }),
        ]);
        expect(anonymous[0]).not.toHaveProperty('table_name');
        expect(anonymous[0]).not.toHaveProperty('metadata');
        expect(anonymous[0]).toMatchObject({
            categoryName: 'Ranh giới hành chính',
            isEnableDefault: true,
        });
        expect(anonymous[0]).toMatchObject({ canEdit: false, editableFields: [] });
        await expect(
            service.listLayers(undefined, { permissions: { map: { view: false } } }),
        ).rejects.toMatchObject({ status: 403 });
    });

    test('catalog exposes sanitized DB-backed Time Series contract', async () => {
        const values = ['2001-01-01T00:00:00.000Z', '2024-01-01T00:00:00.000Z'];
        repository.catalog.mockResolvedValue([
            {
                ...layer,
                storage_kind: 'geotiff_minio',
                metadata: {
                    timeSeries: {
                        enabled: true,
                        coverageKey: 'urban-cover',
                        values: ['client-controlled-value'],
                    },
                },
                time_values: values,
            },
        ]);
        const [result] = await service.listLayers(undefined, null);
        expect(result.timeSeries).toEqual({
            enabled: true,
            mode: 'discrete',
            defaultTime: values[1],
            values,
            members: [],
        });
        expect(result).not.toHaveProperty('metadata');
        expect(result.timeSeries).not.toHaveProperty('coverageKey');
    });
    test('TNMT receives only sanitized per-layer editable fields', async () => {
        repository.catalog.mockResolvedValue([layer]);
        const tnmt = {
            role: 'so_tnmt',
            permissions: {
                map: { view: true },
                map_feature: { update: true },
            },
        };
        await expect(service.listLayers(undefined, tnmt)).resolves.toEqual([
            expect.objectContaining({ canEdit: true, editableFields: ['ten'] }),
        ]);

        repository.catalog.mockResolvedValue([
            { ...layer, metadata: { ...layer.metadata, editableFields: [] } },
        ]);
        await expect(service.listLayers(undefined, tnmt)).resolves.toEqual([
            expect.objectContaining({ canEdit: true, editableFields: [] }),
        ]);
    });

    test('feature query is ACL-filtered and rejects raster', async () => {
        repository.accessibleLayer.mockResolvedValue(layer);
        repository.featureById.mockResolvedValue({ source_fid: 2, ten: 'Cẩm Phả' });
        await expect(service.getFeature(1, 2, false, actor)).resolves.toEqual({
            layerId: 1,
            feature: { source_fid: 2, ten: 'Cẩm Phả' },
        });
        repository.accessibleLayer.mockResolvedValue({ ...layer, storage_kind: 'geotiff_minio' });
        await expect(service.getFeature(1, 2, false, actor)).rejects.toMatchObject({ status: 422 });
        repository.accessibleLayer.mockResolvedValue(null);
        await expect(service.getFeature(99, 2, false, actor)).rejects.toMatchObject({
            status: 404,
        });
    });

    test('search uses configured layers, keeps hard result limit', async () => {
        repository.catalog.mockResolvedValue([layer]);
        repository.searchFields.mockReturnValue(['ten']);
        repository.searchLayer.mockResolvedValue([
            { feature_id: 1, label: 'Cẩm Phả' },
            { feature_id: 2, label: 'Cam Pha' },
        ]);
        await expect(service.searchFeatures({ q: 'cam pha', limit: 1 }, actor)).resolves.toEqual([
            expect.objectContaining({ layerId: 1, feature_id: 1 }),
        ]);
    });

    test('legend, basemap and terrain preserve permissions', async () => {
        repository.accessibleLayer.mockResolvedValue(layer);
        await expect(service.getLegend(1, actor)).resolves.toMatchObject({
            layerId: 1,
            minZoom: 8,
        });
        repository.basemaps.mockResolvedValue([{ code: 'osm' }]);
        await expect(service.listBasemaps(null)).resolves.toEqual([{ code: 'osm' }]);
        repository.terrainCatalog.mockResolvedValue([{ id: 3 }]);
        await expect(service.listTerrain(actor)).resolves.toEqual([{ id: 3 }]);
    });

    test('terrain URL comes only from ACL-filtered raster layer', async () => {
        repository.accessibleLayer.mockResolvedValue({ ...layer, object_key: 'dem/campha.tif' });
        minioService.getPresignedDownloadUrl.mockResolvedValue({
            url: 'https://minio/signed',
            expiresAt: new Date(0),
        });
        await service.getTerrainUrl(1, 300, actor);
        expect(repository.accessibleLayer).toHaveBeenCalledWith(1, actor, { terrain: true });
        expect(minioService.getPresignedDownloadUrl).toHaveBeenCalledWith({
            objectKey: 'dem/campha.tif',
            category: 'raster',
            expireSeconds: 300,
        });
    });
});
