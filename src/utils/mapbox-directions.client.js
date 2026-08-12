'use strict';

const config = require('../configs/routing');

class MapboxDirectionsError extends Error {
    constructor(kind) {
        super(kind);
        this.name = 'MapboxDirectionsError';
        this.kind = kind;
    }
}

const point = (location) => {
    if (
        !Array.isArray(location) ||
        location.length !== 2 ||
        !location.every((value) => Number.isFinite(value))
    ) {
        return null;
    }
    return { type: 'Point', coordinates: location };
};

const validLineString = (geometry) =>
    geometry?.type === 'LineString' &&
    Array.isArray(geometry.coordinates) &&
    geometry.coordinates.length >= 2 &&
    geometry.coordinates.every(
        (coordinate) =>
            Array.isArray(coordinate) &&
            coordinate.length === 2 &&
            coordinate.every((value) => Number.isFinite(value)),
    );

const step = (value) => {
    const instruction = value?.maneuver?.instruction?.trim();
    const maneuverType = value?.maneuver?.type?.trim();
    const location = point(value?.maneuver?.location);
    if (
        !instruction ||
        !maneuverType ||
        !location ||
        !Number.isFinite(value?.distance) ||
        value.distance < 0 ||
        !Number.isFinite(value?.duration) ||
        value.duration < 0
    ) {
        return null;
    }
    const modifier = value.maneuver.modifier?.trim();
    const name = value.name?.trim();
    return {
        instruction: instruction.slice(0, 500),
        maneuverType: maneuverType.slice(0, 50),
        modifier: modifier ? modifier.slice(0, 50) : null,
        name: name ? name.slice(0, 300) : null,
        distanceMeters: value.distance,
        durationSeconds: value.duration,
        location,
    };
};

const steps = (routeValue) => {
    if (!Array.isArray(routeValue?.legs) || routeValue.legs.length === 0) {
        return null;
    }
    const values = routeValue.legs.flatMap((leg) => (Array.isArray(leg?.steps) ? leg.steps : []));
    if (values.length === 0 || values.length > 1000) {
        return null;
    }
    const parsed = values.map(step);
    return parsed.every(Boolean) ? parsed : null;
};

const route = async ({ start, end, profile = config.DEFAULT_PROFILE }) => {
    const accessToken = config.token();
    if (!accessToken) {
        throw new MapboxDirectionsError('not_configured');
    }
    if (!config.PROFILES.has(profile)) {
        throw new MapboxDirectionsError('invalid_profile');
    }

    const coordinates = `${start.join(',')};${end.join(',')}`;
    const url = new URL(`${config.BASE_URL}/${profile}/${coordinates}`);
    url.search = new URLSearchParams({
        alternatives: 'false',
        geometries: 'geojson',
        overview: 'full',
        steps: 'true',
        language: 'vi',
        access_token: accessToken,
    }).toString();

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.timeoutMs());
    let response;
    try {
        response = await fetch(url, {
            headers: { Accept: 'application/json' },
            redirect: 'error',
            signal: controller.signal,
        });
    } catch (error) {
        throw new MapboxDirectionsError(error?.name === 'AbortError' ? 'timeout' : 'unavailable');
    } finally {
        clearTimeout(timer);
    }

    const payload = await response.json().catch(() => null);
    if (['NoRoute', 'NoSegment'].includes(payload?.code)) {
        throw new MapboxDirectionsError('no_route');
    }
    if (response.status === 429) {
        throw new MapboxDirectionsError('rate_limited');
    }
    if ([401, 403].includes(response.status)) {
        throw new MapboxDirectionsError('auth_failed');
    }
    if (!response.ok) {
        throw new MapboxDirectionsError('upstream_error');
    }

    const firstRoute = payload?.routes?.[0];
    const routeSteps = steps(firstRoute);
    const snappedStart = point(payload?.waypoints?.[0]?.location);
    const snappedEnd = point(payload?.waypoints?.at(-1)?.location);
    if (
        payload?.code !== 'Ok' ||
        !validLineString(firstRoute?.geometry) ||
        !Number.isFinite(firstRoute?.distance) ||
        firstRoute.distance < 0 ||
        !Number.isFinite(firstRoute?.duration) ||
        firstRoute.duration < 0 ||
        !routeSteps ||
        !snappedStart ||
        !snappedEnd
    ) {
        throw new MapboxDirectionsError('invalid_response');
    }

    return {
        distanceMeters: firstRoute.distance,
        durationSeconds: firstRoute.duration,
        geometry: firstRoute.geometry,
        steps: routeSteps,
        snappedStart,
        snappedEnd,
    };
};

module.exports = { route, MapboxDirectionsError };
