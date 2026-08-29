'use strict';
process.env.JWT_SECRET ||= 'test-map-proxy-ticket-secret-at-least-32-characters';
jest.mock('../../utils/geoserver.client', () => ({ requestGeoserver: jest.fn() }));
const { requestGeoserver } = require('../../utils/geoserver.client');
const { proxyWms, proxyWfs, proxyWcs, issueTileTicket } = require('../map-proxy.service');
const { verifyTileTicket } = require('../../utils/map-tile-ticket.util');
const { Readable } = require('stream');
const response = (body = '{}', type = 'application/json') => ({
    headers: {
        get: jest.fn((name) =>
            name === 'content-length' ? String(Buffer.byteLength(body)) : type,
        ),
    },
    body: Readable.from([Buffer.from(body)]),
});
describe('map proxy', () => {
    beforeEach(() => jest.clearAllMocks());
    test('forces DB WMS layer and ignores client layer selection by contract', async () => {
        requestGeoserver.mockResolvedValue(response('png', 'image/png'));
        await proxyWms(
            { geoserver_layer: 'campha:flood' },
            {
                version: '1.3.0',
                crs: 'EPSG:5899',
                bbox: '1,2,3,4',
                width: 256,
                height: 256,
                format: 'image/png',
                transparent: true,
            },
        );
        const target = requestGeoserver.mock.calls[0][0];
        expect(target).toContain('layers=campha%3Aflood');
        expect(target).toContain('request=GetMap');
    });
    test('WMS forwards only an active Time Series value as uppercase TIME', async () => {
        requestGeoserver.mockResolvedValue(response('png', 'image/png'));
        const time = '2024-01-01T00:00:00.000Z';
        await proxyWms(
            {
                geoserver_layer: 'campha:urban_cover',
                metadata: { timeSeries: { enabled: true } },
                time_values: [time],
            },
            {
                version: '1.3.0',
                crs: 'EPSG:5899',
                bbox: '1,2,3,4',
                width: 256,
                height: 256,
                format: 'image/png',
                transparent: true,
                time,
            },
        );
        expect(requestGeoserver.mock.calls[0][0]).toContain(`TIME=${encodeURIComponent(time)}`);
    });

    test('WMS requires active time for Time Series and rejects time on regular layers', async () => {
        const query = {
            version: '1.3.0',
            crs: 'EPSG:5899',
            bbox: '1,2,3,4',
            width: 256,
            height: 256,
            format: 'image/png',
            transparent: true,
        };
        const layer = {
            geoserver_layer: 'campha:urban_cover',
            metadata: { timeSeries: { enabled: true } },
            time_values: ['2024-01-01T00:00:00.000Z'],
        };
        await expect(proxyWms(layer, query)).rejects.toMatchObject({ errors: ['TIME_REQUIRED'] });
        await expect(
            proxyWms(layer, { ...query, time: '2023-01-01T00:00:00.000Z' }),
        ).rejects.toMatchObject({ errors: ['TIME_NOT_FOUND'] });
        await expect(
            proxyWms(
                { geoserver_layer: 'campha:roads', metadata: {} },
                {
                    ...query,
                    time: '2024-01-01T00:00:00.000Z',
                },
            ),
        ).rejects.toMatchObject({ errors: ['TIME_NOT_SUPPORTED'] });
        expect(requestGeoserver).not.toHaveBeenCalled();
    });

    test('WMS degrades to a regular layer when the Time Series has no remaining values', async () => {
        requestGeoserver.mockResolvedValue(response('png', 'image/png'));
        const query = {
            version: '1.3.0',
            crs: 'EPSG:5899',
            bbox: '1,2,3,4',
            width: 256,
            height: 256,
            format: 'image/png',
            transparent: true,
        };
        // Ảnh bị soft-delete hết: catalog không phát field timeSeries nên client
        // không thể gửi time, proxy phải phục vụ thay vì khoá cứng bằng 422.
        const layer = {
            geoserver_layer: 'campha:urban_cover',
            metadata: { timeSeries: { enabled: true } },
            time_values: [],
        };
        await expect(proxyWms(layer, query)).resolves.toBeDefined();
        expect(requestGeoserver.mock.calls[0][0]).not.toContain('TIME=');
    });

    test('WFS is fixed to GetFeature and bounded count', async () => {
        requestGeoserver.mockResolvedValue(response('{"type":"FeatureCollection"}'));
        await proxyWfs(
            { geoserver_layer: 'campha:roads' },
            { count: 1000, srsName: 'EPSG:4326', outputFormat: 'application/json' },
        );
        const target = requestGeoserver.mock.calls[0][0];
        expect(target).toContain('request=GetFeature');
        expect(target).toContain('count=1000');
        expect(target).not.toContain('Transaction');
    });
    test('WCS is fixed to the published coverage and GeoTIFF output', async () => {
        requestGeoserver.mockResolvedValue(response('tiff', 'image/tiff'));
        await proxyWcs({ geoserver_layer: 'campha:elevation' }, { format: 'image/tiff' });
        const target = requestGeoserver.mock.calls[0][0];
        expect(target).toContain('request=GetCoverage');
        expect(target).toContain('coverageId=campha__elevation');
        expect(target).toContain('format=image%2Ftiff');
    });
    test('issueTileTicket signs a ticket bound to the layer and requested access', () => {
        const { ticket, expiresAt } = issueTileTicket(
            { id: 8, geoserver_layer: 'campha:flood' },
            'view',
        );
        expect(expiresAt).toBeInstanceOf(Date);
        expect(verifyTileTicket(ticket, 8, 'view')).toBe(true);
        expect(verifyTileTicket(ticket, 8, 'export')).toBe(false);
    });
    test('issueTileTicket refuses layers not published to GeoServer', () => {
        expect(() => issueTileTicket({ id: 9, geoserver_layer: null }, 'view')).toThrow(
            'Lớp chưa được publish trên GeoServer',
        );
    });

    test('WMS injects SLD_BODY for a TREND_MONITORING_V1 flood layer (via layer.code)', async () => {
        requestGeoserver.mockResolvedValue(response('png', 'image/png'));
        await proxyWms(
            {
                geoserver_layer: 'campha:fl_trend_flood_extent_2024_01_18_2024_08_18',
                code: 'fl_trend_flood_extent_2024_01_18_2024_08_18',
                style_name: null,
                metadata: { style: 'flood_extent' },
            },
            {
                version: '1.3.0',
                crs: 'EPSG:5899',
                bbox: '1,2,3,4',
                width: 256,
                height: 256,
                format: 'image/png',
                transparent: true,
            },
        );
        const url = requestGeoserver.mock.calls[0][0];
        expect(url).toContain('SLD_BODY=');
        expect(url).toContain('styles=');
        // styles must be empty when SLD_BODY is present
        expect(url).toMatch(/styles=(&|$)/);
    });

    test('WMS injects SLD_BODY from metadata.style fallback when layer.code is null', async () => {
        requestGeoserver.mockResolvedValue(response('png', 'image/png'));
        await proxyWms(
            {
                geoserver_layer: 'campha:fl_trend_encroachment_alert_2025_01_18_2025_08_18',
                code: null, // simulate missing registry code
                style_name: null,
                metadata: { style: 'encroachment_alert' },
            },
            {
                version: '1.3.0',
                crs: 'EPSG:5899',
                bbox: '1,2,3,4',
                width: 256,
                height: 256,
                format: 'image/png',
                transparent: true,
            },
        );
        const url = requestGeoserver.mock.calls[0][0];
        expect(url).toContain('SLD_BODY=');
    });

    test('WMS does NOT inject SLD_BODY for a non-flood layer (uses GeoServer styles param)', async () => {
        requestGeoserver.mockResolvedValue(response('png', 'image/png'));
        await proxyWms(
            {
                geoserver_layer: 'campha:administrative_boundary',
                code: null,
                style_name: 'admin_boundary_style',
                metadata: {},
            },
            {
                version: '1.3.0',
                crs: 'EPSG:5899',
                bbox: '1,2,3,4',
                width: 256,
                height: 256,
                format: 'image/png',
                transparent: true,
            },
        );
        const url = requestGeoserver.mock.calls[0][0];
        expect(url).not.toContain('SLD_BODY=');
        expect(url).toContain('styles=admin_boundary_style');
    });
});
