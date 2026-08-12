'use strict';

/**
 * Landcover breakdown — hectares per ESA WorldCover class inside the flood.
 *
 * Uses reducers.areaHaByClass to group by class in a single reduceRegion
 * call (Flood_D:4282 does the same with reducer.group).
 *
 * @source docs/Flood_D_final.js (`createLandcoverImpactChart`:4282)
 * @dataset ASSETS.WORLDCOVER
 * @rule    architecture doc §55 — landcover source dataset year in metadata
 */

const { ASSETS } = require('../common/datasets');

/**
 * Full ESA WorldCover class → human label map. Baked so the client can render
 * the impact chart without another asset call.
 */
const WC_CLASS_LABELS = Object.freeze({
    10: { vi: 'Cây', en: 'Tree cover' },
    20: { vi: 'Bụi rậm', en: 'Shrubland' },
    30: { vi: 'Đồng cỏ', en: 'Grassland' },
    40: { vi: 'Đất trồng trọt', en: 'Cropland' },
    50: { vi: 'Đô thị / công trình', en: 'Built-up' },
    60: { vi: 'Đất trống / thưa thớt', en: 'Bare / sparse vegetation' },
    70: { vi: 'Băng tuyết', en: 'Snow and ice' },
    80: { vi: 'Mặt nước', en: 'Permanent water bodies' },
    90: { vi: 'Đất ngập nước thảo mộc', en: 'Herbaceous wetland' },
    95: { vi: 'Rừng ngập mặn', en: 'Mangroves' },
    100: { vi: 'Rêu / địa y', en: 'Moss and lichen' },
});

const LANDCOVER_SOURCE = Object.freeze({
    dataset: ASSETS.WORLDCOVER,
    year: 2021,
    version: 'v200',
    resolutionM: 10,
    provider: 'ESA',
});

/**
 * Load the ESA WorldCover Map band.
 */
function loadLandcoverImage(ee) {
    if (!ee) {throw new Error('impact.landcover.loadLandcoverImage requires the ee module');}
    return ee.ImageCollection(ASSETS.WORLDCOVER).first().select('Map').rename('worldcover_class');
}

/**
 * Given a reducer's grouped-sum output (from reducers.areaHaByClass), turn
 * it into `[{ class, label, areaHa }, ...]`. Silently skips unknown classes.
 */
function summariseLandcoverGroups(groupedResult) {
    if (!groupedResult) {return [];}
    const groups = groupedResult.groups || [];
    return groups
        .map((entry) => {
            const cls = Number(entry.class);
            const label = WC_CLASS_LABELS[cls] || { vi: `Lớp ${cls}`, en: `Class ${cls}` };
            return {
                class: cls,
                label,
                areaHa: Number.isFinite(entry.sum) ? entry.sum : 0,
            };
        })
        .filter((r) => Number.isFinite(r.class));
}

module.exports = {
    WC_CLASS_LABELS,
    LANDCOVER_SOURCE,
    loadLandcoverImage,
    summariseLandcoverGroups,
};
