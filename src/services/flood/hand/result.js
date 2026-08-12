'use strict';

/**
 * M2 HAND scenario artifact catalog + result metadata builder.
 *
 * @rule architecture doc §16 — every UI label MUST say "Kịch bản HAND"
 *       (HAND Scenario), never "Ngập lụt quan sát" (Observed Flood).
 */

const M2_ARTIFACTS = Object.freeze([
    {
        code: 'hand_scenario',
        role: 'PRODUCT',
        label: { vi: 'Kịch bản HAND', en: 'HAND scenario' },
        description:
            'Every pixel where HAND ≤ scenario level would be inundated. This is a scenario, not an observation.',
        style: 'hand_scenario',
    },
    {
        code: 'hand_depth',
        role: 'PRODUCT',
        label: { vi: 'Độ sâu ngập kịch bản HAND (m)', en: 'HAND scenario depth (m)' },
        description: 'Estimated inundation depth = level − HAND (metres). Zero outside the scenario mask.',
        style: 'hand_depth',
    },
]);

const CODE_TO_ARTIFACT = Object.freeze(
    Object.fromEntries(M2_ARTIFACTS.map((a) => [a.code, a])),
);

function selectM2Artifacts({ runMode = 'product' } = {}) {
    return M2_ARTIFACTS.map((a) => ({
        ...a,
        // M2 outputs are PRODUCT in both modes; calibration mode is only for
        // extra diagnostics — no artifact-role change.
        role: runMode === 'calibration' && a.role === 'QA' ? 'CALIBRATION' : a.role,
    }));
}

function buildM2ResultMetadata({
    levelM,
    maximumSlope,
    scenarioAreaHa = null,
    meanDepthM = null,
    maxDepthM = null,
    warnings = [],
} = {}) {
    return {
        levelM: Number.isFinite(levelM) ? levelM : null,
        maximumSlope: Number.isFinite(maximumSlope) ? maximumSlope : null,
        scenarioAreaHa: Number.isFinite(scenarioAreaHa) ? scenarioAreaHa : null,
        meanDepthM: Number.isFinite(meanDepthM) ? meanDepthM : null,
        maxDepthM: Number.isFinite(maxDepthM) ? maxDepthM : null,
        warnings: Array.isArray(warnings) ? warnings : [],
    };
}

module.exports = {
    M2_ARTIFACTS,
    CODE_TO_ARTIFACT,
    selectM2Artifacts,
    buildM2ResultMetadata,
};
