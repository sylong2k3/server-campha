'use strict';

const originalFetch = global.fetch;
const originalToken = process.env.MAPBOX_DIRECTIONS_TOKEN;
const originalTimeout = process.env.MAPBOX_DIRECTIONS_TIMEOUT_MS;
const config = require('../../configs/routing');
const { route, MapboxDirectionsError } = require('../mapbox-directions.client');

const response = (payload, { ok = true, status = 200 } = {}) => ({
    ok,
    status,
    json: jest.fn().mockResolvedValue(payload),
});
const payload = {
    code: 'Ok',
    routes: [
        {
            distance: 1234.5,
            duration: 321.9,
            geometry: {
                type: 'LineString',
                coordinates: [
                    [107.33, 21],
                    [107.34, 21.01],
                ],
            },
            legs: [
                {
                    steps: [
                        {
                            distance: 350.25,
                            duration: 80.5,
                            name: 'Đường Trần Phú',
                            maneuver: {
                                instruction: 'Đi thẳng trên Đường Trần Phú',
                                type: 'depart',
                                modifier: 'straight',
                                location: [107.3301, 21.0001],
                            },
                        },
                        {
                            distance: 884.25,
                            duration: 241.4,
                            name: 'Quốc lộ 18',
                            maneuver: {
                                instruction: 'Rẽ phải vào Quốc lộ 18',
                                type: 'turn',
                                modifier: 'right',
                                location: [107.335, 21.005],
                            },
                        },
                    ],
                },
            ],
        },
    ],
    waypoints: [{ location: [107.3301, 21.0001] }, { location: [107.3399, 21.0099] }],
};

const expectKind = (kind) => expect.objectContaining({ name: 'MapboxDirectionsError', kind });

describe('Mapbox Directions client', () => {
    beforeEach(() => {
        process.env.MAPBOX_DIRECTIONS_TOKEN = 'pk.test-token-not-real';
        process.env.MAPBOX_DIRECTIONS_TIMEOUT_MS = '10000';
        global.fetch = jest.fn();
    });

    afterAll(() => {
        global.fetch = originalFetch;
        if (originalToken === undefined) {
            delete process.env.MAPBOX_DIRECTIONS_TOKEN;
        } else {
            process.env.MAPBOX_DIRECTIONS_TOKEN = originalToken;
        }
        if (originalTimeout === undefined) {
            delete process.env.MAPBOX_DIRECTIONS_TIMEOUT_MS;
        } else {
            process.env.MAPBOX_DIRECTIONS_TIMEOUT_MS = originalTimeout;
        }
    });

    test('calls fixed Mapbox host and parses GeoJSON route', async () => {
        global.fetch.mockResolvedValue(response(payload));
        await expect(
            route({ start: [107.33, 21], end: [107.34, 21.01], profile: 'walking' }),
        ).resolves.toMatchObject({
            distanceMeters: 1234.5,
            durationSeconds: 321.9,
            steps: [
                expect.objectContaining({
                    instruction: 'Đi thẳng trên Đường Trần Phú',
                    modifier: 'straight',
                    distanceMeters: 350.25,
                }),
                expect.objectContaining({ instruction: 'Rẽ phải vào Quốc lộ 18' }),
            ],
            snappedStart: { type: 'Point', coordinates: [107.3301, 21.0001] },
        });

        const [url, options] = global.fetch.mock.calls[0];
        expect(url.origin).toBe('https://api.mapbox.com');
        expect(url.pathname).toBe('/directions/v5/mapbox/walking/107.33,21;107.34,21.01');
        expect(url.searchParams.get('geometries')).toBe('geojson');
        expect(url.searchParams.get('overview')).toBe('full');
        expect(url.searchParams.get('steps')).toBe('true');
        expect(url.searchParams.get('language')).toBe('vi');
        expect(url.searchParams.get('access_token')).toBe('pk.test-token-not-real');
        expect(options.redirect).toBe('error');
    });

    test('rejects missing token and unsupported profile without network', async () => {
        delete process.env.MAPBOX_DIRECTIONS_TOKEN;
        await expect(route({ start: [107.33, 21], end: [107.34, 21.01] })).rejects.toEqual(
            expectKind('not_configured'),
        );
        process.env.MAPBOX_DIRECTIONS_TOKEN = 'pk.test-token-not-real';
        await expect(
            route({ start: [107.33, 21], end: [107.34, 21.01], profile: 'flying' }),
        ).rejects.toEqual(expectKind('invalid_profile'));
        expect(global.fetch).not.toHaveBeenCalled();
    });

    test.each([
        [{ code: 'NoRoute' }, { status: 200 }, 'no_route'],
        [{ code: 'NoSegment' }, { status: 422, ok: false }, 'no_route'],
        [{ code: 'TooManyRequests' }, { status: 429, ok: false }, 'rate_limited'],
        [{ code: 'Forbidden' }, { status: 401, ok: false }, 'auth_failed'],
        [{ code: 'ServerError' }, { status: 500, ok: false }, 'upstream_error'],
    ])('maps upstream payload %# to %s', async (body, options, kind) => {
        global.fetch.mockResolvedValue(response(body, options));
        await expect(route({ start: [107.33, 21], end: [107.34, 21.01] })).rejects.toEqual(
            expectKind(kind),
        );
    });

    test('rejects malformed success and network failure without leaking token', async () => {
        global.fetch.mockResolvedValue(response({ code: 'Ok', routes: [], waypoints: [] }));
        await expect(route({ start: [107.33, 21], end: [107.34, 21.01] })).rejects.toEqual(
            expectKind('invalid_response'),
        );

        global.fetch.mockRejectedValue(new Error('network down pk.test-token-not-real'));
        let caught;
        try {
            await route({ start: [107.33, 21], end: [107.34, 21.01] });
        } catch (error) {
            caught = error;
        }
        expect(caught).toBeInstanceOf(MapboxDirectionsError);
        expect(caught.kind).toBe('unavailable');
        expect(caught.message).not.toContain(config.token());
    });
});
