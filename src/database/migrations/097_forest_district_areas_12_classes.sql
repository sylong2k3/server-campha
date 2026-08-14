-- Complete the Cam Pha 12-class taxonomy migration for persisted district
-- area summaries. Legacy class 12 rows remain available for audit/history;
-- NOT VALID enforces the new range for future inserts and updates.

ALTER TABLE forest.forest_district_areas
    DROP CONSTRAINT IF EXISTS forest_district_areas_class_id_check;

ALTER TABLE forest.forest_district_areas
    ADD CONSTRAINT forest_district_areas_class_id_check
    CHECK (class_id BETWEEN 0 AND 11) NOT VALID;
