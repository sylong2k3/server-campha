-- Migration 099: Lớp dữ liệu kịch bản ngập úng category 'script' (5 kịch bản mô phỏng từ lớp phủ sau ngập 2015, 2018, 2020, 2022, 2024).

INSERT INTO gis.layers (
    code,
    name_vi,
    category,
    category_name,
    geometry_type,
    srid,
    storage_kind,
    table_name,
    geoserver_layer,
    style_name,
    legend_config,
    metadata,
    is_public,
    publish_status,
    is_enable_default
)
VALUES
(
    'script_scenario_1',
    'Kịch bản 1: Ngập lụt nhẹ (Mô phỏng 2015)',
    'script',
    'Kịch bản ngập úng',
    'POLYGON',
    4326,
    'postgis',
    'script_scenario_1',
    'campha:lop_phu_sau_ngap_2015',
    'forecast_flood_mask',
    '{}'::jsonb,
    '{"description": "Kịch bản ngập lụt 1 (Mức độ nhẹ)"}'::jsonb,
    true,
    'published',
    false
),
(
    'script_scenario_2',
    'Kịch bản 2: Ngập lụt trung bình (Mô phỏng 2018)',
    'script',
    'Kịch bản ngập úng',
    'POLYGON',
    4326,
    'postgis',
    'script_scenario_2',
    'campha:lop_phu_sau_ngap_2018',
    'forecast_flood_mask',
    '{}'::jsonb,
    '{"description": "Kịch bản ngập lụt 2 (Mức độ trung bình)"}'::jsonb,
    true,
    'published',
    false
),
(
    'script_scenario_3',
    'Kịch bản 3: Ngập lụt cao (Mô phỏng 2020)',
    'script',
    'Kịch bản ngập úng',
    'POLYGON',
    4326,
    'postgis',
    'script_scenario_3',
    'campha:lop_phu_sau_ngap_2020',
    'forecast_flood_mask',
    '{}'::jsonb,
    '{"description": "Kịch bản ngập lụt 3 (Mức độ cao)"}'::jsonb,
    true,
    'published',
    false
),
(
    'script_scenario_4',
    'Kịch bản 4: Ngập lụt nghiêm trọng (Mô phỏng 2022)',
    'script',
    'Kịch bản ngập úng',
    'POLYGON',
    4326,
    'postgis',
    'script_scenario_4',
    'campha:lop_phu_sau_ngap_2022',
    'forecast_flood_mask',
    '{}'::jsonb,
    '{"description": "Kịch bản ngập lụt 4 (Mức độ nghiêm trọng)"}'::jsonb,
    true,
    'published',
    false
),
(
    'script_scenario_5',
    'Kịch bản 5: Ngập lụt cực đoan (Mô phỏng 2024)',
    'script',
    'Kịch bản ngập úng',
    'POLYGON',
    4326,
    'postgis',
    'script_scenario_5',
    'campha:lop_phu_sau_ngap_2024',
    'forecast_flood_mask',
    '{}'::jsonb,
    '{"description": "Kịch bản ngập lụt 5 (Mức độ cực đoan)"}'::jsonb,
    true,
    'published',
    false
)
ON CONFLICT (code) DO UPDATE
SET
    name_vi = EXCLUDED.name_vi,
    category = EXCLUDED.category,
    category_name = EXCLUDED.category_name,
    geoserver_layer = EXCLUDED.geoserver_layer,
    metadata = EXCLUDED.metadata,
    publish_status = EXCLUDED.publish_status,
    is_public = EXCLUDED.is_public;

UPDATE gis.layers
SET category_name = 'Kịch bản ngập úng'
WHERE category = 'script' AND (category_name IS NULL OR category_name != 'Kịch bản ngập úng');
