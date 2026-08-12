'use strict';

/**
 * Choose the best Sentinel-1 orbit (pass + relative-orbit) for a given
 * (pre-event, post-event) window pair.
 *
 * The scoring rule preserves Flood_D's intent (line 1771):
 *   1. Only orbits that appear in BOTH the pre and post collections qualify.
 *   2. Higher balance (min(preCount, postCount)) beats higher total.
 *   3. Among ties, prefer the orbit with more total scenes (better coverage).
 *
 * The reference uses `evaluate(cb)` for async computation; here we return a
 * Promise via the injected `geeAdapter.evaluate(eeObj)` wrapper. The adapter
 * lives at services/gee-earth-engine.adapter.js — always injectable so
 * unit tests substitute a fake.
 *
 * @source docs/Flood_D_final.js (chooseBestS1Orbit:1771–1913, printOrbitCandidates:1757)
 * @rule   architecture doc §18 no global mutable state
 */

/**
 * Enumerate the distinct orbit_key values in a collection and count
 * occurrences. Both collections have been prepared upstream (edges masked,
 * speckle filtered, orbit_key added — see common/sentinel1.getS1Collection).
 *
 * @param {object} ee
 * @param {object} collection — ee.ImageCollection with 'orbit_key' property
 * @returns {object} ee.Dictionary — { orbit_key: count }
 */
function _countPerOrbit(ee, collection) {
    const keys = collection.aggregate_array('orbit_key');
    return keys.reduce(ee.Reducer.frequencyHistogram());
}

/**
 * Pick the best orbit synchronously from a `{ orbit_key: preCount, ... }` +
 * `{ orbit_key: postCount, ... }` pair, already resolved to plain JS objects.
 *
 * Extracted as a pure function so it can be unit-tested without any ee
 * plumbing.
 *
 * @param {object} preCounts  — { orbitKey: preCount }
 * @param {object} postCounts — { orbitKey: postCount }
 * @returns {{ orbitKey: string, orbitPass: string, relativeOrbit: number,
 *            preCount: number, postCount: number, totalCount: number,
 *            candidates: Array<object> } | null}
 */
function pickBestOrbitFromCounts(preCounts, postCounts) {
    const preKeys = Object.keys(preCounts || {});
    const postKeys = new Set(Object.keys(postCounts || {}));
    const candidates = [];
    for (const key of preKeys) {
        if (!postKeys.has(key)) {
            continue;
        }
        const preCount = Number(preCounts[key]) || 0;
        const postCount = Number(postCounts[key]) || 0;
        if (preCount === 0 || postCount === 0) {
            continue;
        }
        const parsed = parseOrbitKey(key);
        if (!parsed) {
            continue;
        }
        candidates.push({
            orbitKey: key,
            ...parsed,
            preCount,
            postCount,
            balance: Math.min(preCount, postCount),
            totalCount: preCount + postCount,
        });
    }
    if (candidates.length === 0) {
        return null;
    }
    candidates.sort((a, b) => {
        if (a.balance !== b.balance) {
            return b.balance - a.balance;
        }
        return b.totalCount - a.totalCount;
    });
    const best = candidates[0];
    return {
        ...best,
        candidates,
    };
}

/**
 * Parse an `orbit_key` of the form `PASS_RELORBIT` (e.g. `ASCENDING_76`).
 * Returns null on any malformed input so the caller can drop the candidate.
 */
function parseOrbitKey(key) {
    if (typeof key !== 'string' || !key.includes('_')) {
        return null;
    }
    const idx = key.lastIndexOf('_');
    const pass = key.slice(0, idx);
    const relRaw = key.slice(idx + 1);
    const relativeOrbit = Number.parseInt(relRaw, 10);
    if (!Number.isFinite(relativeOrbit)) {
        return null;
    }
    if (pass !== 'ASCENDING' && pass !== 'DESCENDING') {
        return null;
    }
    return { orbitPass: pass, relativeOrbit };
}

/**
 * Async orchestrator. Takes ee + adapter + two prepared collections; returns
 * `{ orbitKey, orbitPass, relativeOrbit, preCount, postCount, ..., candidates }`
 * or `null` when no orbit satisfies "present in both windows".
 *
 * @param {object} ee
 * @param {object} args
 * @param {object} args.preCollection
 * @param {object} args.postCollection
 * @param {{ evaluate: Function }} args.geeAdapter — must expose `evaluate(eeObj) → Promise`
 */
async function chooseBestS1Orbit(ee, { preCollection, postCollection, geeAdapter } = {}) {
    if (!ee) {
        throw new Error('event.orbit-selection.chooseBestS1Orbit requires the ee module');
    }
    if (!preCollection || !postCollection) {
        throw new Error(
            'event.orbit-selection.chooseBestS1Orbit requires preCollection + postCollection',
        );
    }
    if (!geeAdapter || typeof geeAdapter.evaluate !== 'function') {
        throw new Error(
            'event.orbit-selection.chooseBestS1Orbit requires a geeAdapter.evaluate function',
        );
    }

    const preHist = _countPerOrbit(ee, preCollection);
    const postHist = _countPerOrbit(ee, postCollection);
    // Evaluate concurrently — GEE will parallelise these two aggregations.
    const [preCounts, postCounts] = await Promise.all([
        geeAdapter.evaluate(preHist),
        geeAdapter.evaluate(postHist),
    ]);
    return pickBestOrbitFromCounts(preCounts || {}, postCounts || {});
}

/**
 * Diagnostic helper — returns arrays of orbit-keys per collection so admin
 * can inspect what was available. Replaces the reference project's
 * `printOrbitCandidates` (Flood_D:1757).
 */
async function listOrbitCandidates(ee, { collection, geeAdapter } = {}) {
    if (!collection) {
        throw new Error('event.orbit-selection.listOrbitCandidates requires a collection');
    }
    if (!geeAdapter?.evaluate) {
        throw new Error('event.orbit-selection.listOrbitCandidates requires geeAdapter.evaluate');
    }
    const hist = _countPerOrbit(ee, collection);
    const counts = (await geeAdapter.evaluate(hist)) || {};
    return Object.entries(counts).map(([key, count]) => ({
        orbitKey: key,
        ...(parseOrbitKey(key) || { orbitPass: null, relativeOrbit: null }),
        count: Number(count) || 0,
    }));
}

module.exports = {
    chooseBestS1Orbit,
    listOrbitCandidates,
    parseOrbitKey,
    pickBestOrbitFromCounts,
};
