-- Align existing deployments with the Cẩm Phả 12-class land-cover taxonomy
-- (class_id 0-11). Legacy class 12 rows are retained for audit/history; using
-- NOT VALID still enforces the new constraint for all future inserts/updates.

ALTER TABLE forest.forest_gt_zones
    DROP CONSTRAINT IF EXISTS forest_gt_zones_class_id_check;

ALTER TABLE forest.forest_gt_zones
    ADD CONSTRAINT forest_gt_zones_class_id_check
    CHECK (class_id BETWEEN 0 AND 11) NOT VALID;

ALTER TABLE forest.forest_gt_points
    DROP CONSTRAINT IF EXISTS forest_gt_points_class_id_check;

ALTER TABLE forest.forest_gt_points
    ADD CONSTRAINT forest_gt_points_class_id_check
    CHECK (class_id BETWEEN 0 AND 11) NOT VALID;
