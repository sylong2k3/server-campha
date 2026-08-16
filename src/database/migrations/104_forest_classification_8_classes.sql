-- Align existing deployments with the Cẩm Phả 8-class land-cover taxonomy
-- (class_id 0-7). Rows with class_id 8-11 from prior 12-class runs are kept
-- for audit history; NOT VALID enforces the new range for all future inserts
-- and updates without rejecting those historic rows.
--
-- Class mapping (8-class):
--   0 Mặt nước            #0886FB
--   1 Rừng LRTX thưa      #036403
--   2 Dân cư đô thị       #FA9497
--   3 Đất trống khô       #FDFE98
--   4 Bãi khai thác than  #8C5C07
--   5 Cây bụi             #318A07
--   6 Đất trống trảng cỏ  #CFFC15
--   7 Đất nông nghiệp     #FBC695

ALTER TABLE forest.forest_gt_zones
    DROP CONSTRAINT IF EXISTS forest_gt_zones_class_id_check;

ALTER TABLE forest.forest_gt_zones
    ADD CONSTRAINT forest_gt_zones_class_id_check
    CHECK (class_id BETWEEN 0 AND 7) NOT VALID;

ALTER TABLE forest.forest_gt_points
    DROP CONSTRAINT IF EXISTS forest_gt_points_class_id_check;

ALTER TABLE forest.forest_gt_points
    ADD CONSTRAINT forest_gt_points_class_id_check
    CHECK (class_id BETWEEN 0 AND 7) NOT VALID;

ALTER TABLE forest.forest_district_areas
    DROP CONSTRAINT IF EXISTS forest_district_areas_class_id_check;

ALTER TABLE forest.forest_district_areas
    ADD CONSTRAINT forest_district_areas_class_id_check
    CHECK (class_id BETWEEN 0 AND 7) NOT VALID;
