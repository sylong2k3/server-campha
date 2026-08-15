-- Migration 099: Xoá các lớp dữ liệu kịch bản mô phỏng khỏi gis.layers (chưa có trên GeoServer).

DELETE FROM gis.layers
WHERE code IN (
    'script_scenario_1',
    'script_scenario_2',
    'script_scenario_3',
    'script_scenario_4',
    'script_scenario_5'
);
