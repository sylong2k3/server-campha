'use strict';

/**
 * Pipeline + config version identifiers stamped on every analysis run.
 *
 * Runs record `pipeline_version` and `config_version` so historical results
 * remain interpretable if the algorithm or defaults later change (architecture
 * doc §22-B, §49). Do not renumber a version — introduce a new one instead.
 */

const PIPELINE_VERSIONS = Object.freeze({
    EVENT: 'FLOOD_EVENT_V1',
    HAND: 'HAND_V1',
    RAIN_RISK: 'RAIN_RISK_V1',
    IMPACT: 'IMPACT_V1',
    TREND: 'TREND_V1',
    FORECAST: 'FORECAST_V1',
});

const CONFIG_VERSION = 'V1';

const MODULE_TO_PIPELINE_VERSION = Object.freeze({
    event: PIPELINE_VERSIONS.EVENT,
    hand: PIPELINE_VERSIONS.HAND,
    rain: PIPELINE_VERSIONS.RAIN_RISK,
    impact: PIPELINE_VERSIONS.IMPACT,
    trend: PIPELINE_VERSIONS.TREND,
    forecast: PIPELINE_VERSIONS.FORECAST,
});

const pipelineVersionFor = (module) => {
    const version = MODULE_TO_PIPELINE_VERSION[module];
    if (!version) {
        throw new Error(`Unknown flood module '${module}'`);
    }
    return version;
};

module.exports = {
    PIPELINE_VERSIONS,
    CONFIG_VERSION,
    MODULE_TO_PIPELINE_VERSION,
    pipelineVersionFor,
};
