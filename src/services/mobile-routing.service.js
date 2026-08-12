'use strict';

const directions = require('../utils/mapbox-directions.client');
const { Api403Error, Api422Error, Api429Error, Api503Error } = require('../core/error.response');

const mapDirectionsError = (error) => {
    if (!(error instanceof directions.MapboxDirectionsError)) {
        throw error;
    }
    switch (error.kind) {
        case 'no_route':
            throw new Api422Error('Không tìm thấy tuyến đường phù hợp', ['ROUTE_NOT_FOUND']);
        case 'rate_limited':
            throw new Api429Error('Dịch vụ tìm đường đang quá tải, vui lòng thử lại sau', [
                'ROUTING_RATE_LIMITED',
            ]);
        case 'not_configured':
        case 'auth_failed':
            throw new Api503Error('Dịch vụ tìm đường chưa được cấu hình đúng', [
                'ROUTING_UPSTREAM_UNAVAILABLE',
            ]);
        case 'invalid_profile':
            throw new Api422Error('Loại phương tiện không được hỗ trợ', [
                'ROUTING_PROFILE_INVALID',
            ]);
        default:
            throw new Api503Error('Dịch vụ tìm đường tạm thời không khả dụng', [
                'ROUTING_UPSTREAM_UNAVAILABLE',
            ]);
    }
};

const shortest = async (input, actor) => {
    if (actor && actor.permissions?.map?.route !== true) {
        throw new Api403Error('Không có quyền tìm đường');
    }

    let result;
    try {
        result = await directions.route(input);
    } catch (error) {
        mapDirectionsError(error);
    }

    return {
        provider: 'mapbox',
        profile: input.profile,
        distance_m: Number(result.distanceMeters.toFixed(2)),
        duration_s: Number(result.durationSeconds.toFixed(2)),
        geometry: result.geometry,
        steps: result.steps.map((step) => ({
            instruction: step.instruction,
            maneuver_type: step.maneuverType,
            modifier: step.modifier,
            name: step.name,
            distance_m: Number(step.distanceMeters.toFixed(2)),
            duration_s: Number(step.durationSeconds.toFixed(2)),
            location: step.location,
        })),
        snapped_start: result.snappedStart,
        snapped_end: result.snappedEnd,
    };
};

module.exports = { shortest };
