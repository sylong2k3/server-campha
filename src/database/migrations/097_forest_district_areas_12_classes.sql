-- Complete the Cam Pha 12-class taxonomy migration for persisted district
-- area summaries. Some historic deployments recorded migration 083 while this
-- derived table was later removed, so restore it before tightening the range.

CREATE TABLE IF NOT EXISTS forest.forest_district_areas (
    id              BIGSERIAL PRIMARY KEY,
    snapshot_id     BIGINT NOT NULL REFERENCES forest.forest_snapshots(id) ON DELETE CASCADE,
    district_code   TEXT,
    district_name   TEXT,
    class_id        SMALLINT NOT NULL CHECK (class_id BETWEEN 0 AND 11),
    class_name      TEXT NOT NULL,
    area_ha         NUMERIC NOT NULL CHECK (area_ha >= 0),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (snapshot_id, district_code, class_id)
);

CREATE INDEX IF NOT EXISTS idx_forest_district_areas_snapshot
    ON forest.forest_district_areas (snapshot_id, district_name, class_id);

-- Existing deployments may still use the original 0-12 constraint. Legacy
-- class 12 rows remain available for audit/history; NOT VALID enforces the new
-- range for future inserts and updates without rejecting those historic rows.

ALTER TABLE forest.forest_district_areas
    DROP CONSTRAINT IF EXISTS forest_district_areas_class_id_check;

ALTER TABLE forest.forest_district_areas
    ADD CONSTRAINT forest_district_areas_class_id_check
    CHECK (class_id BETWEEN 0 AND 11) NOT VALID;
