'use strict';

/**
 * M1 event-flood publication + QA artifact definitions.
 *
 * Every artifact code below corresponds to a row that will be created in
 * `gis.flood_artifacts` after the run. `artifact_role='PRODUCT'` means the
 * client is allowed to see it; `QA` is admin-only calibration surface.
 *
 * The publication pipeline (services/raster-ingest.publish + orchestrator)
 * reads this catalog to decide which bands to Export to GCS + which to publish
 * to GeoServer.
 *
 * @source docs/Flood_D_final.js publication surface (§ Flood_D catalog §7)
 * @rule   architecture doc §31 — do NOT publish internal intermediary rasters
 * @rule   architecture doc §69 — CALIBRATION artifacts never auto-published
 */

/**
 * Canonical M1 artifact catalog. Order matters — earlier entries are exported
 * first so the client sees the MAIN product before QA layers finish.
 */
const M1_ARTIFACTS = Object.freeze([
    {
        code: 'main_flood_non_tidal',
        role: 'PRODUCT',
        label: {
            vi: 'Ngập lụt',
            en: 'Confirmed flood',
        },
        description:
            'Main reportable flood mask from Sentinel-1. Tidal-uncertainty pixels are excluded here per §80 — those live in tidal_candidate.',
        style: 'flood_main',
    },
    {
        code: 'open_water',
        role: 'PRODUCT',
        label: { vi: 'Mặt nước mở', en: 'Open water' },
        description: 'Dark-flood pixels (deep, non-turbid open water).',
        style: 'open_water',
    },
    {
        code: 'shallow_flood',
        role: 'QA',
        label: { vi: 'Ngập nông (QA)', en: 'Shallow flood (QA)' },
        description:
            'Shallow-flood branch output. Enabled only when enableShallowFlood=true (default true).',
        style: 'shallow_flood',
    },
    {
        code: 'tidal_candidate',
        role: 'QA',
        label: { vi: 'Nghi vùng triều', en: 'Tidal candidate (QA)' },
        description:
            'PROXY-ONLY. Historical tidal zones with dark backscatter. Never merge into confirmed flood totals per §80.',
        style: 'tidal_candidate',
    },
    {
        code: 'mining_candidate',
        role: 'QA',
        label: { vi: 'Nghi khai trường mỏ', en: 'Mining candidate (QA)' },
        description:
            'Bare-ground + terrain heuristic. Coal-mining pits masquerade as flood on SAR. QA only per §81.',
        style: 'mining_candidate',
    },
    {
        code: 'urban_double_bounce',
        role: 'QA',
        label: { vi: 'Nghi phản xạ đôi đô thị (QA)', en: 'Urban double-bounce (QA)' },
        description:
            'Empty when enableUrbanDoubleBounce=false (default). Historical FP=89% on slopes.',
        style: 'urban_double_bounce',
    },
]);

const CODE_TO_ARTIFACT = Object.freeze(Object.fromEntries(M1_ARTIFACTS.map((a) => [a.code, a])));

/**
 * Return the subset of M1 artifacts that should be materialised for the
 * requested run mode + toggles. Skips branches that were disabled in config.
 *
 * @param {object} args
 * @param {boolean} args.enableShallowFlood
 * @param {boolean} args.enableUrbanDoubleBounce
 * @param {'product'|'calibration'} args.runMode
 * @returns {Array<object>} — subset of M1_ARTIFACTS in publication order
 */
function selectM1Artifacts({
    enableShallowFlood = true,
    enableUrbanDoubleBounce = false,
    runMode = 'product',
} = {}) {
    return M1_ARTIFACTS.filter((a) => {
        if (a.code === 'shallow_flood' && !enableShallowFlood) {
            return false;
        }
        if (a.code === 'urban_double_bounce' && !enableUrbanDoubleBounce) {
            return false;
        }
        // QA artifacts still ship in product mode but aren't auto-published;
        // orchestrator + publisher enforce that separately.
        return true;
    }).map((a) => ({
        ...a,
        role: runMode === 'calibration' && a.role === 'QA' ? 'CALIBRATION' : a.role,
    }));
}

/**
 * Metadata payload persisted on every M1 artifact row (rasterGeeMetadata
 * JSON stored on flood_artifacts.bbox etc after the ingest completes).
 */
function buildM1ResultMetadata({
    orbitKey,
    orbitPass,
    relativeOrbit,
    lastM1Threshold,
    preSceneCount,
    postSceneCount,
    preStart,
    preEnd,
    postStart,
    postEnd,
    warnings = [],
} = {}) {
    return {
        orbitKey: orbitKey || null,
        orbitPass: orbitPass || null,
        relativeOrbit: Number.isFinite(relativeOrbit) ? relativeOrbit : null,
        lastM1Threshold: Number.isFinite(lastM1Threshold) ? lastM1Threshold : null,
        preSceneCount: Number.isFinite(preSceneCount) ? preSceneCount : null,
        postSceneCount: Number.isFinite(postSceneCount) ? postSceneCount : null,
        preStart: preStart || null,
        preEnd: preEnd || null,
        postStart: postStart || null,
        postEnd: postEnd || null,
        warnings,
    };
}

module.exports = {
    M1_ARTIFACTS,
    CODE_TO_ARTIFACT,
    selectM1Artifacts,
    buildM1ResultMetadata,
};
