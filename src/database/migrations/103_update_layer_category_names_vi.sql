-- Migration 103: Update map layer category display names (category_name) to standard Vietnamese

UPDATE gis.layers
SET category_name = CASE
    WHEN LOWER(TRIM(COALESCE(category, ''))) = 'flood' OR LOWER(TRIM(COALESCE(category_name, ''))) = 'flood' THEN 'Ngập lụt'
    WHEN LOWER(TRIM(COALESCE(category, ''))) = 'forest' OR LOWER(TRIM(COALESCE(category_name, ''))) = 'forest' THEN 'Phân loại đối tượng'
    WHEN LOWER(TRIM(COALESCE(category, ''))) = 'lop-phu-ngap' OR LOWER(TRIM(COALESCE(category_name, ''))) = 'lop-phu-ngap' THEN 'Lớp phủ ngập'
    WHEN LOWER(TRIM(COALESCE(category, ''))) IN ('ranh gioi', 'ranh_gioi', 'boundary', 'administrative')
      OR LOWER(TRIM(COALESCE(category_name, ''))) IN ('ranh gioi', 'ranh_gioi', 'boundary', 'administrative') THEN 'Ranh giới'
    WHEN LOWER(TRIM(COALESCE(category, ''))) IN ('thoat nuoc', 'thoat_nuoc')
      OR LOWER(TRIM(COALESCE(category_name, ''))) IN ('thoat nuoc', 'thoat_nuoc') THEN 'Thoát nước'
    WHEN LOWER(TRIM(COALESCE(category, ''))) = 'land_cover' THEN 'Lớp phủ mặt đất'
    WHEN LOWER(TRIM(COALESCE(category, ''))) = 'remote_sensing' THEN 'Ảnh viễn thám'
    WHEN LOWER(TRIM(COALESCE(category, ''))) = 'hydrology' THEN 'Thủy văn'
    WHEN LOWER(TRIM(COALESCE(category, ''))) IN ('giao_thong', 'transportation', 'transport') THEN 'Giao thông'
    WHEN LOWER(TRIM(COALESCE(category, ''))) = 'infrastructure' THEN 'Hạ tầng'
    WHEN LOWER(TRIM(COALESCE(category, ''))) = 'environment' THEN 'Môi trường'
    WHEN LOWER(TRIM(COALESCE(category, ''))) = 'agriculture' THEN 'Nông nghiệp'
    WHEN LOWER(TRIM(COALESCE(category, ''))) = 'forestry' THEN 'Lâm nghiệp'
    WHEN LOWER(TRIM(COALESCE(category, ''))) = 'weather' THEN 'Thời tiết'
    ELSE COALESCE(category_name, INITCAP(REPLACE(REPLACE(category, '_', ' '), '-', ' ')))
END
WHERE deleted_at IS NULL;
