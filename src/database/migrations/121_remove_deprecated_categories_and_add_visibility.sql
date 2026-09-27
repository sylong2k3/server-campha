-- Migration 121: Thêm cột is_visible cho danh mục, cập nhật chuyển các lớp dùng danh mục cũ sang 'other' và xóa 4 danh mục không còn sử dụng

ALTER TABLE gis.layer_categories
    ADD COLUMN IF NOT EXISTS is_visible BOOLEAN NOT NULL DEFAULT true;

-- Đảm bảo danh mục 'other' (Khác) tồn tại trong bảng layer_categories
INSERT INTO gis.layer_categories (key, name_vi, is_visible)
VALUES ('other', 'Khác', true)
ON CONFLICT (key) DO UPDATE
SET is_visible = EXCLUDED.is_visible;

-- Chuyển các lớp trong gis.layers đang thuộc 4 danh mục lỗi thời sang danh mục 'other'
UPDATE gis.layers
SET category = 'other',
    category_name = 'Khác'
WHERE category IN ('remote_sensing', 'land_cover', 'forest_district', 'thuy_van');

-- Xóa 4 danh mục được yêu cầu khỏi bảng gis.layer_categories
DELETE FROM gis.layer_categories
WHERE key IN ('remote_sensing', 'land_cover', 'forest_district', 'thuy_van');
