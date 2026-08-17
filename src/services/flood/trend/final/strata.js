'use strict';

/**
 * 3-stratum stratification for FINAL M5.
 *
 * Strata (priority: mine > urban > non-urban):
 *   1 = non-urban  — standard flood detection (ratio > Otsu)
 *   2 = urban      — double-bounce detection (VH increase)
 *   3 = mine       — excluded from product; monitored separately
 *
 * Mine stratum sources (OR-combined):
 *   A. Admin polygon asset (highest priority, if provided)
 *   B. WorldCover bare-ground proxy (class 60)
 *   C. SAR mine-like heuristic: reference VH < mineLikeDbMax AND JRC occurrence < mineLikeOccMax
 *
 * @ported-from final_code.js §9B + §9C
 * @dataset ESA/WorldCover/v200, JRC/GSW1_4/GlobalSurfaceWater
 */

const { ASSETS } = require('../../common/datasets');

// WorldCover class codes used by this module
const WC_BUILT = 50;   // Built-up / urban
const WC_BARE  = 60;   // Bare / sparse vegetation (mine proxy)

// WorldCover cropland — used by impact.js, exported here for reuse
const WC_CROPLAND = 40;

/**
 * Build stratification images and ephemeral-water mask.
 *
 * @param {object} ee
 * @param {object} args
 * @param {object} args.referenceVhNatural  — VH reference image (natural units)
 * @param {object} args.gswImage            — pre-loaded JRC GSW image
 * @param {object} [args.worldCoverImage]   — pre-loaded WorldCover image (optional)
 * @param {object} args.config              — TREND_FINAL_DEFAULTS merged with runConfig
 * @returns {{ mineStratum, urbanStratum, nonUrbanStratum, stratumImage, ephemeralWater }}
 */
function buildStrata(ee, { referenceVhNatural, gswImage, worldCoverImage = null, config }) {
  if (!ee) throw new Error('strata.buildStrata requires the ee module');

  // ── WorldCover base ─────────────────────────────────────────────────────
  const wc = (worldCoverImage || ee.ImageCollection(ASSETS.WORLDCOVER).first()).select('Map');
  const builtUpMask = wc.eq(WC_BUILT).unmask(0);
  const bareMask    = wc.eq(WC_BARE).unmask(0);

  // ── JRC occurrence ──────────────────────────────────────────────────────
  const wOccur = gswImage.select('occurrence').unmask(0); // 0–100 %

  // ── Mine polygon (optional) ─────────────────────────────────────────────
  let insideMinePolygon = ee.Image.constant(0).toByte();
  if (config.minePolygonAsset && config.minePolygonAsset.trim().length > 0) {
    const mineFc = ee.FeatureCollection(config.minePolygonAsset);
    insideMinePolygon = ee.Image.constant(1).paint(mineFc, 0).not().unmask(0).toByte();
  }

  // ── SAR mine-like heuristic ─────────────────────────────────────────────
  // Reference VH (natural) → dB for the threshold comparison
  const refVhDb = referenceVhNatural.max(1e-9).log10().multiply(10).rename('ref_vh_db');
  const mineLikeSAR = config.useMineLikeSAR
    ? refVhDb.lt(config.mineLikeDbMax).and(wOccur.lt(config.mineLikeOccMax)).unmask(0).toByte()
    : ee.Image.constant(0).toByte();

  // ── Bare proxy ──────────────────────────────────────────────────────────
  const bareAsMine = config.mineFromBareGround ? bareMask : ee.Image.constant(0).toByte();

  // ── Combine mine stratum ────────────────────────────────────────────────
  const mineStratum = insideMinePolygon.or(bareAsMine).or(mineLikeSAR)
    .rename('mine_stratum').toByte();

  // ── Urban stratum (built AND NOT mine) ─────────────────────────────────
  const urbanStratum = builtUpMask.and(mineStratum.not())
    .rename('urban_stratum').toByte();

  // ── Non-urban stratum (remainder) ───────────────────────────────────────
  const nonUrbanStratum = mineStratum.not().and(urbanStratum.not())
    .rename('nonurban_stratum').toByte();

  // ── Numeric stratum image (for export/QA) ───────────────────────────────
  const stratumImage = ee.Image(1)
    .where(urbanStratum, 2)
    .where(mineStratum, 3)
    .rename('stratum').toByte();

  // ── Ephemeral water mask ─────────────────────────────────────────────────
  const ephemeralWater = wOccur.gt(config.ephemeralOccMin)
    .and(wOccur.lte(config.ephemeralOccMax))
    .rename('ephemeral_water').toByte();

  return { mineStratum, urbanStratum, nonUrbanStratum, stratumImage, ephemeralWater, wOccur };
}

module.exports = { buildStrata, WC_BUILT, WC_BARE, WC_CROPLAND };
