'use strict';

/**
 * Otsu threshold + robust-sigma helpers used by M1 (and reused by M5 when
 * threshold-mode = 'otsu' or 'median_sigma').
 *
 * The Flood_D reference log documented that Otsu on log-VH ratios often
 * produces unimodal histograms and thresholds that fall outside a scientific
 * acceptance band. The safe wrapper here:
 *   1. Computes Otsu
 *   2. Clamps to the [otsuMinDb, otsuMaxDb] acceptance band
 *   3. Falls back to a supplied `vhFallbackDb` when the histogram is invalid
 *      (empty / single-bucket / all-null)
 *
 * `median_sigma` mode is a robust alternative: threshold = median + k×IQR/1.349
 * (Flood_D:2626–2713). Same clamp / fallback rules apply.
 *
 * @source docs/Flood_D_final.js (otsuSafe:1400, computeMedianSigmaThreshold:1573)
 */

const {
    ANALYSIS_CRS,
    ANALYSIS_SCALE_M,
    DIAGNOSTIC_TILE_SCALE,
    REDUCE_MAX_PIXELS,
} = require('./projection');

/**
 * Robust-sigma factor: dividing IQR by 1.349 approximates the standard
 * deviation of a normal distribution (Flood_D:2660).
 */
const IQR_TO_SIGMA = 1 / 1.349;

/**
 * Compute Otsu on a histogram Dict. Standard 1-D Otsu — maximises inter-class
 * variance between two Gaussians.
 *
 * @param {object} ee
 * @param {object} histogramArray — ee.Array (from ee.Reducer.histogram output)
 * @param {number} fallback       — dB used if Otsu returns invalid
 * @returns {object} ee.Number (dB) — clamped by caller
 */
function otsu(ee, histogramArray, fallback) {
    if (!ee) {
        throw new Error('otsu.otsu requires the ee module');
    }
    if (!histogramArray) {
        throw new Error('otsu.otsu requires a histogram');
    }
    // Guard: an empty / masked histogram returns null via computed image ops.
    const safeArray = ee.Algorithms.If(histogramArray, histogramArray, ee.Array([0, 0, 0]));
    const arr = ee.Array(safeArray);

    // Split bucket counts from bucket mid-values.
    const counts = arr.slice(1, 0, 1).project([0]);
    const means = arr.slice(1, 1, 2).project([0]);
    const size = means.length().get([0]);
    const total = counts.reduce(ee.Reducer.sum(), [0]).get([0]);
    // ee.List of bucket indices — used to iterate the histogram.
    const indices = ee.List.sequence(1, size);

    // For each split point k, compute inter-class variance.
    const bss = indices.map((i) => {
        const iNum = ee.Number(i);
        const aCounts = counts.slice(0, 0, iNum);
        const aMeans = means.slice(0, 0, iNum);
        const bCounts = counts.slice(0, iNum);
        const bMeans = means.slice(0, iNum);
        const aTotal = aCounts.reduce(ee.Reducer.sum(), [0]).get([0]);
        const bTotal = bCounts.reduce(ee.Reducer.sum(), [0]).get([0]);
        const aMean = aMeans
            .multiply(aCounts)
            .reduce(ee.Reducer.sum(), [0])
            .get([0])
            .divide(aTotal);
        const bMean = bMeans
            .multiply(bCounts)
            .reduce(ee.Reducer.sum(), [0])
            .get([0])
            .divide(bTotal);
        // BSS = w_a × w_b × (μ_a - μ_b)²
        return aTotal
            .divide(total)
            .multiply(bTotal.divide(total))
            .multiply(aMean.subtract(bMean).pow(2));
    });
    const bssArr = ee.Array(bss);
    const maxIdx = bssArr.argmax().get(0);
    const threshold = means.get([maxIdx]);
    // Server-side fallback when threshold is null/NaN.
    return ee.Number(ee.Algorithms.If(threshold, threshold, fallback));
}

/**
 * Otsu threshold on a band with the acceptance band + fallback.
 *
 * @param {object} ee
 * @param {object} args
 * @param {object} args.image
 * @param {string} args.band
 * @param {object} args.geometry
 * @param {number} args.minDb    — lower clamp (otsuMinDb)
 * @param {number} args.maxDb    — upper clamp (otsuMaxDb)
 * @param {number} args.fallback — vhFallbackDb when the histogram is invalid
 * @param {number} [args.scale=ANALYSIS_SCALE_M]
 * @param {string} [args.crs=ANALYSIS_CRS]
 * @param {number} [args.buckets=256] — histogram resolution
 * @returns {{ threshold: object, usedFallback: object }}
 */
function otsuThresholdOnBand(
    ee,
    {
        image,
        band,
        geometry,
        minDb,
        maxDb,
        fallback,
        scale = ANALYSIS_SCALE_M,
        crs = ANALYSIS_CRS,
        buckets = 256,
    } = {},
) {
    if (!ee) {
        throw new Error('otsu.otsuThresholdOnBand requires the ee module');
    }
    if (!image || !band || !geometry) {
        throw new Error('otsu.otsuThresholdOnBand requires image + band + geometry');
    }
    if (!Number.isFinite(minDb) || !Number.isFinite(maxDb) || !Number.isFinite(fallback)) {
        throw new Error('otsu.otsuThresholdOnBand requires numeric minDb + maxDb + fallback');
    }

    const stats = image.select(band).reduceRegion({
        reducer: ee.Reducer.histogram({ maxBuckets: buckets }),
        geometry,
        scale,
        crs,
        maxPixels: REDUCE_MAX_PIXELS,
        tileScale: DIAGNOSTIC_TILE_SCALE,
        bestEffort: true,
    });
    const hist = ee.Dictionary(stats.get(band));
    const arr = ee.Array([hist.get('bucketMeans'), hist.get('histogram')]);
    const raw = otsu(ee, arr, fallback);
    // Clamp to acceptance band; when raw was already the fallback, this is a no-op.
    const clamped = raw.max(minDb).min(maxDb);
    const usedFallback = ee.Number(raw.eq(fallback));
    return { threshold: clamped, rawThreshold: raw, usedFallback };
}

/**
 * Robust median + k×IQR/1.349 threshold on a band.
 * `median_sigma` alternative to Otsu (Flood_D:2626–2713).
 */
function computeMedianSigmaThreshold(
    ee,
    {
        image,
        band,
        geometry,
        k,
        minDb,
        maxDb,
        fallback,
        scale = ANALYSIS_SCALE_M,
        crs = ANALYSIS_CRS,
    } = {},
) {
    if (!ee) {
        throw new Error('otsu.computeMedianSigmaThreshold requires the ee module');
    }
    if (!image || !band || !geometry) {
        throw new Error('otsu.computeMedianSigmaThreshold requires image + band + geometry');
    }
    if (![k, minDb, maxDb, fallback].every(Number.isFinite)) {
        throw new Error(
            'otsu.computeMedianSigmaThreshold requires numeric k + minDb + maxDb + fallback',
        );
    }
    const percentileStats = image.select(band).reduceRegion({
        reducer: ee.Reducer.percentile([25, 50, 75]),
        geometry,
        scale,
        crs,
        maxPixels: REDUCE_MAX_PIXELS,
        tileScale: DIAGNOSTIC_TILE_SCALE,
        bestEffort: true,
    });
    const p25 = ee.Number(percentileStats.get(`${band}_p25`));
    const median = ee.Number(percentileStats.get(`${band}_p50`));
    const p75 = ee.Number(percentileStats.get(`${band}_p75`));
    const iqr = p75.subtract(p25).max(0.1); // Flood_D:2660 sigma floor
    const sigma = iqr.multiply(IQR_TO_SIGMA);
    const raw = median.add(sigma.multiply(k));
    const rawValid = ee.Algorithms.If(raw, raw, fallback);
    const rawNum = ee.Number(rawValid);
    const clamped = rawNum.max(minDb).min(maxDb);
    const usedFallback = ee.Number(rawNum.eq(fallback));
    return { threshold: clamped, rawThreshold: rawNum, usedFallback };
}

module.exports = {
    IQR_TO_SIGMA,
    otsu,
    otsuThresholdOnBand,
    computeMedianSigmaThreshold,
};
