'use strict';

const {
    chooseBestS1Orbit,
    listOrbitCandidates,
    parseOrbitKey,
    pickBestOrbitFromCounts,
} = require('../orbit-selection');

// Bare-minimum ee stub — orbit-selection only uses aggregate_array + reduce.
const makeEe = () => {
    const calls = [];
    const record =
        (name) =>
        (...args) => {
            calls.push({ name, args });
            return { aggregate_array: () => ({ reduce: () => ({}) }) };
        };
    return {
        Reducer: { frequencyHistogram: record('Reducer.frequencyHistogram') },
        calls,
    };
};

const makeAdapter = (preCounts, postCounts) => {
    const calls = [];
    return {
        evaluate: jest.fn().mockImplementation(async () => {
            calls.push(true);
            return calls.length === 1 ? preCounts : postCounts;
        }),
    };
};

describe('parseOrbitKey', () => {
    test('accepts ASCENDING_76 → {orbitPass:ASCENDING, relativeOrbit:76}', () => {
        expect(parseOrbitKey('ASCENDING_76')).toEqual({
            orbitPass: 'ASCENDING',
            relativeOrbit: 76,
        });
    });
    test('accepts DESCENDING_54 → {orbitPass:DESCENDING, relativeOrbit:54}', () => {
        expect(parseOrbitKey('DESCENDING_54')).toEqual({
            orbitPass: 'DESCENDING',
            relativeOrbit: 54,
        });
    });
    test('rejects unknown pass values', () => {
        expect(parseOrbitKey('SIDEWAYS_76')).toBeNull();
    });
    test('rejects malformed keys (no underscore, non-integer suffix)', () => {
        expect(parseOrbitKey('ASCENDING')).toBeNull();
        expect(parseOrbitKey('ASCENDING_abc')).toBeNull();
        expect(parseOrbitKey(null)).toBeNull();
        expect(parseOrbitKey(76)).toBeNull();
    });
});

describe('pickBestOrbitFromCounts', () => {
    test('returns null when the two histograms share no keys', () => {
        expect(pickBestOrbitFromCounts({ ASCENDING_76: 3 }, { DESCENDING_54: 2 })).toBeNull();
    });

    test('returns null when the only shared key has zero on one side', () => {
        expect(pickBestOrbitFromCounts({ ASCENDING_76: 0 }, { ASCENDING_76: 2 })).toBeNull();
    });

    test('prefers higher balance (min(pre,post))', () => {
        const res = pickBestOrbitFromCounts(
            { ASCENDING_76: 5, DESCENDING_54: 1 },
            { ASCENDING_76: 3, DESCENDING_54: 10 },
        );
        // ASCENDING_76 balance = 3; DESCENDING_54 balance = 1 → pick ASCENDING_76
        expect(res.orbitKey).toBe('ASCENDING_76');
        expect(res.balance).toBe(3);
    });

    test('breaks ties on totalCount (higher wins)', () => {
        const res = pickBestOrbitFromCounts(
            { ASCENDING_76: 2, DESCENDING_54: 2 },
            { ASCENDING_76: 3, DESCENDING_54: 2 },
        );
        // Balance both = 2, but totalCount differs (5 vs 4) → ASCENDING_76
        expect(res.orbitKey).toBe('ASCENDING_76');
        expect(res.totalCount).toBe(5);
    });

    test('returns full metadata including candidate list', () => {
        const res = pickBestOrbitFromCounts(
            { ASCENDING_76: 5, DESCENDING_54: 3 },
            { ASCENDING_76: 4, DESCENDING_54: 3 },
        );
        expect(res.orbitPass).toBe('ASCENDING');
        expect(res.relativeOrbit).toBe(76);
        expect(res.preCount).toBe(5);
        expect(res.postCount).toBe(4);
        expect(Array.isArray(res.candidates)).toBe(true);
        expect(res.candidates).toHaveLength(2);
    });

    test('skips malformed orbit_key entries defensively', () => {
        const res = pickBestOrbitFromCounts(
            { BAD_KEY: 5, ASCENDING_76: 3 },
            { BAD_KEY: 5, ASCENDING_76: 3 },
        );
        // BAD_KEY parses to non-integer suffix (KEY) → skipped; ASCENDING_76 wins by default
        expect(res.orbitKey).toBe('ASCENDING_76');
    });
});

describe('chooseBestS1Orbit', () => {
    test('rejects missing collections / adapter', async () => {
        const ee = makeEe();
        await expect(chooseBestS1Orbit(ee, {})).rejects.toThrow();
        await expect(
            chooseBestS1Orbit(ee, { preCollection: {}, postCollection: {} }),
        ).rejects.toThrow(/geeAdapter/);
    });

    test('resolves the two aggregations in parallel then picks the best orbit', async () => {
        const ee = makeEe();
        const adapter = makeAdapter({ ASCENDING_76: 3 }, { ASCENDING_76: 2 });
        const preCollection = { aggregate_array: () => ({ reduce: () => ({}) }) };
        const postCollection = { aggregate_array: () => ({ reduce: () => ({}) }) };
        const res = await chooseBestS1Orbit(ee, {
            preCollection,
            postCollection,
            geeAdapter: adapter,
        });
        expect(adapter.evaluate).toHaveBeenCalledTimes(2);
        expect(res.orbitKey).toBe('ASCENDING_76');
    });

    test('returns null when the two windows share no orbit', async () => {
        const ee = makeEe();
        const adapter = makeAdapter({ ASCENDING_76: 3 }, { DESCENDING_54: 2 });
        const preCollection = { aggregate_array: () => ({ reduce: () => ({}) }) };
        const postCollection = { aggregate_array: () => ({ reduce: () => ({}) }) };
        const res = await chooseBestS1Orbit(ee, {
            preCollection,
            postCollection,
            geeAdapter: adapter,
        });
        expect(res).toBeNull();
    });
});

describe('listOrbitCandidates', () => {
    test('returns [{orbitKey, orbitPass, relativeOrbit, count}, ...]', async () => {
        const ee = makeEe();
        const adapter = {
            evaluate: jest.fn().mockResolvedValue({
                ASCENDING_76: 4,
                DESCENDING_54: 2,
            }),
        };
        const list = await listOrbitCandidates(ee, {
            collection: { aggregate_array: () => ({ reduce: () => ({}) }) },
            geeAdapter: adapter,
        });
        expect(list).toEqual(
            expect.arrayContaining([
                {
                    orbitKey: 'ASCENDING_76',
                    orbitPass: 'ASCENDING',
                    relativeOrbit: 76,
                    count: 4,
                },
                {
                    orbitKey: 'DESCENDING_54',
                    orbitPass: 'DESCENDING',
                    relativeOrbit: 54,
                    count: 2,
                },
            ]),
        );
    });

    test('rejects missing collection / adapter', async () => {
        const ee = makeEe();
        await expect(listOrbitCandidates(ee, {})).rejects.toThrow(/collection/);
        await expect(
            listOrbitCandidates(ee, {
                collection: { aggregate_array: () => ({ reduce: () => ({}) }) },
            }),
        ).rejects.toThrow(/geeAdapter/);
    });
});
