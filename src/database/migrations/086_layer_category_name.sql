-- Vietnamese display label for each layer category.
-- `category` remains a stable machine-readable grouping key; administrators can
-- change `category_name` without changing that key.
ALTER TABLE gis.layers
    ADD COLUMN IF NOT EXISTS category_name VARCHAR(120);

UPDATE gis.layers
SET category_name = CASE category
    WHEN 'land_cover' THEN 'Lớp phủ mặt đất'
    WHEN 'remote_sensing' THEN 'Ảnh viễn thám'
    WHEN 'flood' THEN 'Ngập lụt và thủy văn'
    WHEN 'flood_event' THEN 'Hiện trạng ngập theo sự kiện'
    WHEN 'flood_risk' THEN 'Chỉ số nguy cơ ngập'
    WHEN 'flood_impact' THEN 'Tác động ngập lụt'
    WHEN 'flood_trend' THEN 'Xu thế ngập lụt'
    WHEN 'forest_district' THEN 'Phân loại đối tượng theo huyện'
    WHEN 'administrative' THEN 'Ranh giới hành chính'
    WHEN 'hanh_chinh' THEN 'Hành chính'
    WHEN 'hydrology' THEN 'Thủy văn'
    WHEN 'thuy_van' THEN 'Thủy văn'
    WHEN 'transportation' THEN 'Giao thông'
    WHEN 'transport' THEN 'Giao thông'
    WHEN 'giao_thong' THEN 'Giao thông'
    WHEN 'infrastructure' THEN 'Hạ tầng'
    WHEN 'environment' THEN 'Môi trường'
    WHEN 'agriculture' THEN 'Nông nghiệp'
    WHEN 'forestry' THEN 'Lâm nghiệp'
    WHEN 'forest' THEN 'Rừng'
    WHEN 'weather' THEN 'Thời tiết'
    WHEN 'lop-phu-ngap' THEN 'Lớp phủ ngập'
    WHEN 'other' THEN 'Khác'
    ELSE INITCAP(REPLACE(REPLACE(category, '_', ' '), '-', ' '))
END
WHERE category_name IS NULL
  AND category IS NOT NULL;

COMMENT ON COLUMN gis.layers.category_name IS
    'Vietnamese display name for the stable category key shown in WebGIS and admin.';
