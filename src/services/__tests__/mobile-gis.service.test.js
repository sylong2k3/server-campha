'use strict';
jest.mock('../../repositories/mobile-gis.repository');
jest.mock('../../repositories/web-map.repository');
jest.mock('../../repositories/mobile-feature-edit.repository');
jest.mock('../../utils/openweather.client');
const repository = require('../../repositories/mobile-gis.repository');
const webMap = require('../../repositories/web-map.repository');
const editRepository = require('../../repositories/mobile-feature-edit.repository');
const weather = require('../../utils/openweather.client');
const config = require('../../configs/weather');
const service = require('../mobile-gis.service');
const actor = {
    id: 1,
    role: 'citizen',
    permissions: {
        map: { view: true, view_attributes: true, locate: true, measure: true, draw: true },
        weather: { read: true },
    },
};
describe('mobile GIS service', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        webMap.accessibleLayer.mockResolvedValue({
            id: 1,
            code: 'roads',
            storage_kind: 'postgis',
            table_name: 'roads',
            publish_status: 'published',
            min_zoom: 0,
            max_zoom: 20,
        });
    });
    test('uses accessible layer before MVT and nearby', async () => {
        repository.vectorTile.mockResolvedValue(Buffer.from('tile'));
        repository.nearby.mockResolvedValue([]);
        await expect(service.tile(1, 12, 1, 1, actor)).resolves.toEqual(Buffer.from('tile'));
        await service.nearby(
            1,
            { longitude: 107.3, latitude: 21, radiusMeters: 100, limit: 20 },
            actor,
        );
        expect(webMap.accessibleLayer).toHaveBeenCalledTimes(2);
    });
    test('TNMT feature detail returns authoritative snapshot and version', async () => {
        webMap.accessibleLayer.mockResolvedValue({
            id: 1,
            storage_kind: 'postgis',
            table_name: 'roads',
            publish_status: 'published',
            role_can_edit: true,
        });
        webMap.featureById.mockResolvedValue({ source_fid: '7', name: 'display' });
        editRepository.snapshot.mockResolvedValue({
            feature_id: '7',
            attributes: { name: 'editable' },
            geometry: { type: 'Point', coordinates: [107.3, 21] },
        });
        editRepository.state.mockResolvedValue({ version: 4 });
        const tnmt = {
            ...actor,
            role: 'so_tnmt',
            permissions: {
                ...actor.permissions,
                map_feature: { update: true },
            },
        };
        await expect(service.feature(1, '7', tnmt)).resolves.toEqual({
            layerId: 1,
            feature: {
                source_fid: '7',
                name: 'editable',
                geometry: { type: 'Point', coordinates: [107.3, 21] },
                version: 4,
            },
        });
    });
    test('blocks permission and hides other owner draft', async () => {
        await expect(
            service.measure({ geometry: {} }, { ...actor, permissions: { map: {} } }),
        ).rejects.toMatchObject({ status: 403 });
        repository.findDraft.mockResolvedValue(null);
        await expect(service.getDraft(9, actor)).rejects.toMatchObject({ status: 404 });
    });
    test('maps minimal weather payload', async () => {
        jest.spyOn(config, 'isOpenWeatherConfigured').mockReturnValue(true);
        weather.getCurrentWeather.mockResolvedValue({
            observedAt: '2026-01-01T00:00:00.000Z',
            location: 'Cẩm Phả',
            temp: 24,
            wind: { speed: 3, deg: 90 },
            weather: { description: 'mây' },
        });
        await expect(
            service.currentWeather({ longitude: 107.3, latitude: 21 }, actor),
        ).resolves.toMatchObject({ temperatureC: 24, windSpeedMps: 3, windDirectionDegrees: 90 });
    });
});
