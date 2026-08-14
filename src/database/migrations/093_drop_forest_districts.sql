-- Drop the per-district decomposition of forest classification results.
--
-- Cẩm Phả is one administrative unit (a city, not a province) and the analysis
-- now runs against a single AOI polygon for the whole city. Per-district
-- aggregation is not needed by any client, has no data path (the pipeline was
-- computing province-wide stats and only ever seeded these tables as empty
-- placeholders), and the polling loop the admin ran against
-- /snapshots/:id/districts was consuming server round-trips for nothing.
--
-- Destructive migration: rows are unrecoverable. The service is switching to
-- the single-AOI response shape at the same commit, so keeping the tables
-- around would only accumulate stale data and confuse operators.

DROP TRIGGER IF EXISTS trigger_forest_district_exports_updated_at
    ON forest.forest_district_exports;

DROP INDEX IF EXISTS forest.idx_forest_district_exports_ingest;
DROP INDEX IF EXISTS forest.idx_forest_district_exports_snapshot;
DROP TABLE IF EXISTS forest.forest_district_exports;

DROP INDEX IF EXISTS forest.idx_forest_district_areas_snapshot;
DROP TABLE IF EXISTS forest.forest_district_areas;
