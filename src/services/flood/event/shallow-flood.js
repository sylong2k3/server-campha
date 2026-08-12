'use strict';

/**
 * Shallow-flood branch (Flood_D:2157–2196).
 *
 * Catches damp / partially-inundated pixels whose VH backscatter has dropped
 * but not to open-water levels. Only votes for pixels that are NOT already
 * classified as dark flood (so the two branches don't double-count).
 *
 * Gated by `enableShallowFlood` — default TRUE. When disabled the
 * classifier drops this branch entirely.
 *
 * @source docs/Flood_D_final.js (lines 2157–2196)
 * @rule   architecture doc §15 (thresholds locked)
 */

/**
 * @param {object} ee
 * @param {object} args
 * @param {object} args.postVH               — post-event VH (dB)
 * @param {object} args.vhDecrease           — pre − post VH (dB, positive = decrease)
 * @param {number} args.vhDecreaseDb         — base threshold (Flood_D:109 vhDecreaseDb=2.0)
 * @param {number} args.shallowExtraDb       — extra decrease required (Flood_D:208 = 0.4)
 * @param {number} args.shallowPostVHDb      — absolute VH floor for shallow (Flood_D:209 = -15.5)
 * @param {number} args.postVHDbDarkFloor    — dark-flood exclusion floor (Flood_D:112 = -18)
 * @returns {object} ee.Image (binary vote, 1 = shallow flood, 0 elsewhere)
 */
function shallowFloodVote(
    ee,
    { postVH, vhDecrease, vhDecreaseDb, shallowExtraDb, shallowPostVHDb, postVHDbDarkFloor } = {},
) {
    if (!ee) {throw new Error('event.shallow-flood.shallowFloodVote requires the ee module');}
    if (!postVH || !vhDecrease) {
        throw new Error('event.shallow-flood.shallowFloodVote requires postVH + vhDecrease');
    }
    if (
        !Number.isFinite(vhDecreaseDb) ||
        !Number.isFinite(shallowExtraDb) ||
        !Number.isFinite(shallowPostVHDb) ||
        !Number.isFinite(postVHDbDarkFloor)
    ) {
        throw new Error(
            'event.shallow-flood.shallowFloodVote requires numeric vhDecreaseDb + shallowExtraDb + shallowPostVHDb + postVHDbDarkFloor',
        );
    }

    const decreaseGate = vhDecrease.gte(vhDecreaseDb + shallowExtraDb);
    const absoluteGate = postVH.lte(shallowPostVHDb);
    // Exclude dark-flood pixels: postVH ≥ -18 dB (would already be counted by
    // the dark branch; don't double-count).
    const notDarkFlood = postVH.gt(postVHDbDarkFloor);
    return decreaseGate.and(absoluteGate).and(notDarkFlood).rename('shallow_flood_vote');
}

module.exports = { shallowFloodVote };
