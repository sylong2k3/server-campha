'use strict';

/**
 * M1 Sentinel-1 flood classifier — dark-flood + shallow + urban branch
 * combination.
 *
 * The reference `classifySinglePostImage` (Flood_D:2090–2243) votes each
 * post-event image independently; `processS1FloodV3` (Flood_D:2506–3401)
 * then reduces per-pixel votes across N post images (voteCount ≥ minimumVotes
 * AND voteFraction ≥ minimumVoteFraction).
 *
 * This module implements the two functions as separate exports so each is
 * unit-testable. Every gate uses locked thresholds from
 * services/flood/config/defaults.js.
 *
 * @source docs/Flood_D_final.js (classifySinglePostImage:2090–2243,
 *                                processS1FloodV3:2506–3401)
 * @rule   architecture doc §15 — thresholds locked
 * @rule   §50 — respect eventMode override (single image sufficient)
 */

const { shallowFloodVote } = require('./shallow-flood');
const { urbanDoubleBounceVote } = require('./urban-double-bounce');

/**
 * Compute dark-flood support votes (Flood_D:2109–2141).
 *
 * A pixel votes "dark flood" when 3/3 support signals fire:
 *   1. VV decrease ≥ vvDecreaseDb
 *   2. post VH ≤ postVHDb
 *   3. post VV ≤ postVVDb
 *
 * @returns {object} ee.Image (integer count 0..3)
 */
function darkFloodSupportScore(ee, { preVV, postVV, postVH, thresholds }) {
    if (!ee) {
        throw new Error('event.classifier.darkFloodSupportScore requires the ee module');
    }
    if (!preVV || !postVV || !postVH || !thresholds) {
        throw new Error(
            'event.classifier.darkFloodSupportScore requires preVV/postVV/postVH/thresholds',
        );
    }
    const vvDecrease = preVV.subtract(postVV);
    const vote1 = vvDecrease.gte(thresholds.vvDecreaseDb);
    const vote2 = postVH.lte(thresholds.postVHDb);
    const vote3 = postVV.lte(thresholds.postVVDb);
    return vote1.add(vote2).add(vote3).rename('dark_support');
}

/**
 * Vote for one post-event image.
 *
 * @param {object} ee
 * @param {object} args
 * @param {object} args.preBaselineVV
 * @param {object} args.preBaselineVH
 * @param {object} args.postVV
 * @param {object} args.postVH
 * @param {object} args.vhScale                 — from event.baseline.createS1BaselineScale (per-pixel σ)
 * @param {object} args.vvScale
 * @param {number} args.decisionThreshold       — dB — output of the threshold module (fixed/otsu/median_sigma)
 * @param {object} args.thresholds              — S1_THRESHOLDS from config/defaults
 * @param {object} [args.shallowContext]        — enable via { enableShallowFlood, shallowExtraDb, shallowPostVHDb }
 * @param {object} [args.urbanContext]          — enable via { enableUrban, thresholds }
 * @param {number} args.minimumDarkSupportVotes — Flood_D:191 (default 3)
 * @returns {object} ee.Image with bands:
 *          `flood_vote` (0/1), `dark_support`, `shallow_vote` (if enabled),
 *          `urban_vote` (if enabled), plus Z-score bands for diagnostics.
 */
function classifySinglePostImage(
    ee,
    {
        preBaselineVV,
        preBaselineVH,
        postVV,
        postVH,
        vhScale,
        vvScale,
        decisionThreshold,
        thresholds,
        shallowContext = null,
        urbanContext = null,
        minimumDarkSupportVotes,
    } = {},
) {
    if (!ee) {
        throw new Error('event.classifier.classifySinglePostImage requires the ee module');
    }
    for (const [name, val] of Object.entries({
        preBaselineVV,
        preBaselineVH,
        postVV,
        postVH,
        vhScale,
        vvScale,
        thresholds,
    })) {
        if (!val) {
            throw new Error(`event.classifier.classifySinglePostImage requires ${name}`);
        }
    }
    if (!Number.isFinite(minimumDarkSupportVotes)) {
        throw new Error(
            'event.classifier.classifySinglePostImage requires numeric minimumDarkSupportVotes',
        );
    }

    const vhDecrease = preBaselineVH.subtract(postVH);
    const vvDecrease = preBaselineVV.subtract(postVV);
    // Z-scores (per-pixel standardised change) — used both to gate the dark
    // branch and by the urban branch for its VV Z threshold.
    const vhZ = vhDecrease.divide(vhScale);
    const vvZ = vvDecrease.divide(vvScale).abs();

    // ── Dark-flood branch ────────────────────────────────────────────
    // VH decrease clears the decision threshold (adaptive/fixed dB).
    const vhDecreaseGate = vhDecrease.gte(decisionThreshold);
    const darkSupport = darkFloodSupportScore(ee, {
        preVV: preBaselineVV,
        postVV,
        postVH,
        thresholds,
    });
    const darkFloodVote = vhDecreaseGate
        .and(darkSupport.gte(minimumDarkSupportVotes))
        .rename('dark_flood_vote');

    // ── Shallow-flood branch (optional) ──────────────────────────────
    let shallowVote = null;
    if (shallowContext?.enableShallowFlood) {
        shallowVote = shallowFloodVote(ee, {
            postVH,
            vhDecrease,
            vhDecreaseDb: thresholds.vhDecreaseDb,
            shallowExtraDb: shallowContext.shallowExtraDb,
            shallowPostVHDb: shallowContext.shallowPostVHDb,
            postVHDbDarkFloor: thresholds.postVHDb,
        });
    }

    // ── Urban double-bounce branch (optional, default OFF) ──────────
    let urbanVote = null;
    if (urbanContext?.enableUrban) {
        urbanVote = urbanDoubleBounceVote(ee, {
            vvIncrease: postVV.subtract(preBaselineVV),
            vvZ,
            vhDecrease,
            builtDensity: urbanContext.builtDensity,
            slopeDeg: urbanContext.slopeDeg,
            handImage: urbanContext.handImage,
            thresholds: urbanContext.thresholds,
        });
    }

    // ── Combine ─────────────────────────────────────────────────────
    let combined = darkFloodVote;
    if (shallowVote) {
        combined = combined.or(shallowVote);
    }
    if (urbanVote) {
        combined = combined.or(urbanVote);
    }

    let bands = combined
        .rename('flood_vote')
        .addBands(darkFloodVote)
        .addBands(darkSupport)
        .addBands(vhZ.rename('vh_z'))
        .addBands(vvZ.rename('vv_z'));
    // ee.Image is immutable: preserve the returned image after addBands.
    if (shallowVote) {
        bands = bands.addBands(shallowVote);
    }
    if (urbanVote) {
        bands = bands.addBands(urbanVote);
    }
    return bands;
}

/**
 * Fold N per-image vote images into a single flood mask.
 *
 * @param {object} ee
 * @param {object} args
 * @param {object} args.voteCollection      — ee.ImageCollection of classify() outputs
 * @param {number} args.minimumVotes         — Flood_D:185 (or 1 in eventMode)
 * @param {number} args.minimumObservations  — Flood_D:186 (or 1 in eventMode)
 * @param {number} args.minimumVoteFraction  — Flood_D:187 (or 0 in eventMode)
 * @returns {object} ee.Image (binary flood mask)
 */
function reduceVotesToMask(
    ee,
    {
        voteCollection,
        band = 'flood_vote',
        minimumVotes,
        minimumObservations,
        minimumVoteFraction,
    } = {},
) {
    if (!ee) {
        throw new Error('event.classifier.reduceVotesToMask requires the ee module');
    }
    if (!voteCollection) {
        throw new Error('event.classifier.reduceVotesToMask requires voteCollection');
    }
    for (const [name, val] of Object.entries({
        minimumVotes,
        minimumObservations,
        minimumVoteFraction,
    })) {
        if (!Number.isFinite(val)) {
            throw new Error(`event.classifier.reduceVotesToMask requires numeric ${name}`);
        }
    }
    const votes = voteCollection.select(band);
    const voteCount = votes.sum();
    const obsCount = votes.count();
    // fraction = voteCount / obsCount (guard against div-by-zero via .max(1))
    const voteFraction = voteCount.divide(obsCount.max(1));
    return voteCount
        .gte(minimumVotes)
        .and(obsCount.gte(minimumObservations))
        .and(voteFraction.gte(minimumVoteFraction))
        .rename(`${band}_mask`);
}

/**
 * Apply the eventMode override to reducer thresholds (Flood_D:199, 2305–2310).
 * In event mode a single post-event image is enough — voteFraction is dropped
 * to 0 so a single positive vote passes.
 */
function applyEventModeOverride({
    eventMode,
    minimumVotes,
    minimumObservations,
    minimumVoteFraction,
}) {
    if (!eventMode) {
        return { minimumVotes, minimumObservations, minimumVoteFraction };
    }
    return { minimumVotes: 1, minimumObservations: 1, minimumVoteFraction: 0 };
}

module.exports = {
    darkFloodSupportScore,
    classifySinglePostImage,
    reduceVotesToMask,
    applyEventModeOverride,
};
