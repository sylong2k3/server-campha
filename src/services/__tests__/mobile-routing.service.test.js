'use strict';

jest.mock('../../utils/mapbox-directions.client', () => ({
    route: jest.fn(),
    MapboxDirectionsError: class MapboxDirectionsError extends Error {
        constructor(kind) {
            super(kind);
            this.name = 'MapboxDirectionsError';
            this.kind = kind;
        }
    },
}));
const directions = require('../../utils/mapbox-directions.client');
const service = require('../mobile-routing.service');

const actor = { permissions: { map: { route: true } } };
const input = {
    start: [107.33, 21],
    end: [107.34, 21.01],
    profile: 'driving',
};
const result = {
    distanceMeters: 1234.567,
    durationSeconds: 321.987,
    geometry: {
        type: 'LineString',
        coordinates: [
            [107.3301, 21.0001],
            [107.3399, 21.0099],
        ],
    },
    steps: [
        {
            instruction: 'Rẽ phải vào Quốc lộ 18',
            maneuverType: 'turn',
            modifier: 'right',
            name: 'Quốc lộ 18',
            distanceMeters: 456.789,
            durationSeconds: 98.765,
            location: { type: 'Point', coordinates: [107.335, 21.005] },
        },
    ],
    snappedStart: { type: 'Point', coordinates: [107.3301, 21.0001] },
    snappedEnd: { type: 'Point', coordinates: [107.3399, 21.0099] },
};

const failure = (kind) => new directions.MapboxDirectionsError(kind);

describe('mobile Mapbox routing service', () => {
    beforeEach(() => jest.clearAllMocks());

    test('returns the Mapbox mobile contract', async () => {
        directions.route.mockResolvedValue(result);
        await expect(service.shortest(input, actor)).resolves.toEqual({
            provider: 'mapbox',
            profile: 'driving',
            distance_m: 1234.57,
            duration_s: 321.99,
            geometry: result.geometry,
            steps: [
                {
                    instruction: 'Rẽ phải vào Quốc lộ 18',
                    maneuver_type: 'turn',
                    modifier: 'right',
                    name: 'Quốc lộ 18',
                    distance_m: 456.79,
                    duration_s: 98.77,
                    location: { type: 'Point', coordinates: [107.335, 21.005] },
                },
            ],
            snapped_start: result.snappedStart,
            snapped_end: result.snappedEnd,
        });
        expect(directions.route).toHaveBeenCalledWith(input);
    });

    test('blocks actors without route permission before calling Mapbox', async () => {
        await expect(
            service.shortest(input, { permissions: { map: { route: false } } }),
        ).rejects.toMatchObject({ status: 403 });
        expect(directions.route).not.toHaveBeenCalled();
    });

    test.each(['no_route'])('maps %s to route not found', async (kind) => {
        directions.route.mockRejectedValue(failure(kind));
        await expect(service.shortest(input, actor)).rejects.toMatchObject({
            status: 422,
            errors: ['ROUTE_NOT_FOUND'],
        });
    });

    test('maps upstream rate limit to HTTP 429', async () => {
        directions.route.mockRejectedValue(failure('rate_limited'));
        await expect(service.shortest(input, actor)).rejects.toMatchObject({
            status: 429,
            errors: ['ROUTING_RATE_LIMITED'],
        });
    });

    test.each(['not_configured', 'auth_failed', 'timeout', 'unavailable', 'invalid_response'])(
        'maps %s to a safe HTTP 503',
        async (kind) => {
            directions.route.mockRejectedValue(failure(kind));
            await expect(service.shortest(input, actor)).rejects.toMatchObject({
                status: 503,
                errors: ['ROUTING_UPSTREAM_UNAVAILABLE'],
            });
        },
    );
});
