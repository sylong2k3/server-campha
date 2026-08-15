'use strict';

/**
 * Projection constants for the flood analysis pipeline.
 *
 * EPSG:32648 (UTM Zone 48N) is the working CRS across every flood module —
 * Cẩm Phả sits at ~107.3° E / 21° N which places it inside UTM 48N. The
 * pipeline's §22-F CRS gate rejects any raster whose CRS is not in
 * ALLOWED_CRS (see services/raster-ingest.pipeline.js).
 *
 * @source Flood_D_final.js:2560 — setDefaultProjection('EPSG:32648', scale=30)
 * @source floodTrend_ft_final.js:621–625 — ANALYSIS_CRS='EPSG:32648', scale=10
 */

const ANALYSIS_CRS = 'EPSG:32648';

/** Working scale in metres. 30 m matches the ~30 m of Sentinel-1 GRD IW when downsampled */
const ANALYSIS_SCALE_M = 30;

/**
 * M5 (Trend) scale for the DOWNLOAD path. Kept at 30 m to stay well under
 * GEE's `getDownloadURL` compute quota (~256 MB per request). Trend outputs
 * are counts / class rasters that don't benefit from sub-Sentinel-1 resolution.
 * Reference project used 10 m but exported via Cloud Storage batch, which has
 * no such quota — we no longer use GCS (see run-executor).
 */
const TREND_ANALYSIS_SCALE_M = 30;

/**
 * Client-facing basemap CRS. Included so publish-side reprojection has a
 * single authoritative target.
 */
const CLIENT_BASEMAP_CRS = 'EPSG:4326';

/** Diagnostic (calibration) reducer tile scale — high enough to fit large AOIs. */
const DIAGNOSTIC_TILE_SCALE = 4;

/** Max pixels used in every reduce* call. Aligned with Flood_D:254. */
const REDUCE_MAX_PIXELS = 1e10;

module.exports = {
    ANALYSIS_CRS,
    ANALYSIS_SCALE_M,
    TREND_ANALYSIS_SCALE_M,
    CLIENT_BASEMAP_CRS,
    DIAGNOSTIC_TILE_SCALE,
    REDUCE_MAX_PIXELS,
};
