-- Reset all forest classification runtime data accumulated under the old
-- 12-class taxonomy. Structural tables (schema, indexes, constraints, RBAC)
-- are kept intact; only row-level data is removed.
--
-- Scope:
--   • forest.forest_snapshots          — all snapshot runs + their province_summary JSON
--   • forest.forest_district_areas     — per-class area rows (CASCADE from snapshots)
--   • forest.forest_district_exports   — per-district GEE export jobs (CASCADE)
--   • forest.forest_gt_zones           — ground-truth polygon zones
--   • forest.forest_gt_points          — ground-truth sample points
--
-- NOT touched:
--   • Schema structure, indexes, constraints, triggers
--   • RBAC (auth.roles permissions)
--   • raster_ingest_jobs rows are left in gis schema (they self-expire)

-- Child tables that cascade from forest_snapshots are cleared first to
-- satisfy FK constraints before truncating the parent.
TRUNCATE TABLE
    forest.forest_district_exports,
    forest.forest_district_areas,
    forest.forest_snapshots
RESTART IDENTITY CASCADE;

-- Ground-truth data is independent (no FK to snapshots) — clear separately.
TRUNCATE TABLE
    forest.forest_gt_zones,
    forest.forest_gt_points
RESTART IDENTITY;
