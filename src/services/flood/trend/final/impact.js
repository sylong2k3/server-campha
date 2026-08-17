'use strict';

/**
 * Population and crop/built-up impact analysis for FINAL M5.
 *
 * Moved INTO M5-FINAL because FINAL bundles impact with the trend analysis
 * in a single GEE execution (vs V1 where M4 was a separate module).
 *
 * Data sources:
 *   - Population: WorldPop VNM 2020 100 m (@dataset ASSETS.WORLDPOP_VNM_2020)
 *   - Crop/built: ESA WorldCover v200 (@dataset ASSETS.WORLDCOVER)
 *
 * @ported-from final_code.js §22
 */

const { ASSETS } = require('../../common/datasets');
const { WC_CROPLAND } = require('./strata');

// WorldCover class codes used here
const WC_BUILT = 50;

/**
 * Build population and agricultural impact layers.
 *
 * @param {object} ee
 * @param {object} args
 * @param {object} args.aoi
 * @param {object} args.floodExtent     — binary image (1 = flooded in >= 1 season)
 * @param {object} [args.worldCoverImage] — pre-loaded WC image (optional, loaded if absent)
 * @returns {{ popAffected, cropAffected, builtAffected }}
 */
function buildImpactProducts(ee, { aoi, floodExtent, worldCoverImage = null }) {
  // ── Population ──────────────────────────────────────────────────────────
  const worldPop = ee.Image(ASSETS.WORLDPOP_VNM_2020).clip(aoi).rename('population');
  const popAffected = worldPop.updateMask(floodExtent).rename('pop_affected').toFloat();

  // ── WorldCover land-cover classes ────────────────────────────────────────
  const wc = (worldCoverImage || ee.ImageCollection(ASSETS.WORLDCOVER).first())
    .select('Map').clip(aoi);

  // Cropland intersected with flood extent
  const cropAffected = wc.eq(WC_CROPLAND).and(floodExtent.unmask(0))
    .selfMask().rename('crop_affected').toByte();

  // Built-up intersected with flood extent (informational)
  const builtAffected = wc.eq(WC_BUILT).and(floodExtent.unmask(0))
    .selfMask().rename('built_affected').toByte();

  return { popAffected, cropAffected, builtAffected };
}

module.exports = { buildImpactProducts, WC_BUILT };
