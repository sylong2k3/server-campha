-- Bảng danh mục lớp bản đồ động dùng chung giữa server và client/admin.
CREATE TABLE IF NOT EXISTS gis.layer_categories (
    id SERIAL PRIMARY KEY,
    key VARCHAR(50) NOT NULL UNIQUE,
    name_vi VARCHAR(120) NOT NULL,
    created_by BIGINT REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_layer_categories_lower_name
    ON gis.layer_categories (LOWER(TRIM(name_vi)));

DROP TRIGGER IF EXISTS trigger_layer_categories_updated_at ON gis.layer_categories;
CREATE TRIGGER trigger_layer_categories_updated_at
    BEFORE UPDATE ON gis.layer_categories
    FOR EACH ROW
    EXECUTE FUNCTION core.update_updated_at_column();

COMMENT ON TABLE gis.layer_categories IS
    'Danh mục chuẩn dùng cho các lớp dữ liệu bản đồ, có thể tạo mới động từ trang quản trị.';

-- Khởi tạo các nhóm lớp mặc định theo hằng số hệ thống
INSERT INTO gis.layer_categories (key, name_vi)
VALUES
    ('land_cover', 'Lớp phủ mặt đất'),
    ('flood', 'Ngập lụt và thủy văn'),
    ('remote_sensing', 'Ảnh viễn thám'),
    ('forest_district', 'Phân loại đối tượng theo huyện'),
    ('hanh_chinh', 'Hành chính'),
    ('thuy_van', 'Thủy văn'),
    ('giao_thong', 'Giao thông')
ON CONFLICT (key) DO UPDATE
SET name_vi = EXCLUDED.name_vi;

-- Đồng bộ bù các danh mục đã từng được đặt trong gis.layers trước đây
INSERT INTO gis.layer_categories (key, name_vi)
SELECT DISTINCT
    TRIM(l.category) AS key,
    COALESCE(NULLIF(TRIM(l.category_name), ''), TRIM(l.category)) AS name_vi
FROM gis.layers l
WHERE l.category IS NOT NULL
  AND TRIM(l.category) <> ''
  AND TRIM(l.category) <> 'other'
ON CONFLICT (key) DO NOTHING;
