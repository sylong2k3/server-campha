-- Migration 101: Xoá tất cả các lớp bản đồ kịch bản HAND khỏi gis.layers.
-- Các lớp này có code theo pattern fl_hand_<artifact_code>_r<run_id> (ví dụ:
-- fl_hand_hand_scenario_r16, fl_hand_hand_depth_r22...) được tạo bởi pipeline
-- M2 HAND nhưng chưa tồn tại trên GeoServer và module M2 đã bị loại bỏ.

DELETE FROM gis.layers
WHERE code LIKE 'fl_hand_%';

-- Xoá luôn các artifact liên quan trong bảng flood_artifacts (nếu có)
DELETE FROM gis.flood_artifacts
WHERE module = 'hand';
