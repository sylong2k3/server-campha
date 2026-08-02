'use strict';
jest.mock('../../utils/geoserver.client', () => ({ requestGeoserver: jest.fn() }));
const { requestGeoserver } = require('../../utils/geoserver.client');
const { proxyWms, proxyWfs } = require('../map-proxy.service');
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
});
