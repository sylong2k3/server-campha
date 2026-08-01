-- Migration 002: CẨM PHẢ FOUNDATION — roles, organizations, layer ACL
-- Forward-only: giữ nguyên migration 000 đã có thể chạy trên production.

-- Đổi role cũ và bảo toàn FK của người dùng; gộp nếu role đích đã tồn tại.
DO $$
DECLARE old_id INT; target_id INT;
BEGIN
    SELECT id INTO old_id FROM auth.roles WHERE code = 'ubnd_tinh';
    SELECT id INTO target_id FROM auth.roles WHERE code = 'ubnd_tp';
    IF old_id IS NOT NULL THEN
        IF target_id IS NULL THEN
            UPDATE auth.roles SET code = 'ubnd_tp' WHERE id = old_id;
        ELSE
            UPDATE auth.users SET role_id = target_id WHERE role_id = old_id;
            DELETE FROM auth.roles WHERE id = old_id;
        END IF;
    END IF;
END $$;

DO $$
DECLARE old_id INT; target_id INT;
BEGIN
    SELECT id INTO old_id FROM auth.roles WHERE code = 'so_nnmt';
    SELECT id INTO target_id FROM auth.roles WHERE code = 'so_tnmt';
    IF old_id IS NOT NULL THEN
        IF target_id IS NULL THEN
            UPDATE auth.roles SET code = 'so_tnmt' WHERE id = old_id;
        ELSE
            UPDATE auth.users SET role_id = target_id WHERE role_id = old_id;
            DELETE FROM auth.roles WHERE id = old_id;
        END IF;
    END IF;
END $$;

-- 5 role đăng nhập. KH là anonymous; GEE là service account, không thuộc auth.roles.
INSERT INTO auth.roles (
    code, name_vi, name_en, description_vi, description_en, permissions, sort_order, is_active
)
VALUES
(
    'system_admin', 'Quản trị hệ thống', 'System Administrator',
    'Vận hành hạ tầng và tài khoản Cẩm Phả; không được phân quyền tài khoản, phân quyền lớp, sửa hoặc xóa dữ liệu bản đồ.',
    'Operates Cẩm Phả infrastructure and accounts; cannot grant roles or layer permissions, nor edit or delete map data.',
    '{
      "users":{"read":true,"create":true,"delete":true,"change_status":true,"reset_password":true,"read_own":true,"update_own":true},
      "system_logs":{"read":true,"manage":true},
      "layers":{"create":true,"read":true},
      "raster":{"create":true,"delete":true,"categorize":true,"read":true,"compare":true,"search":true,"download":true,"classify":true,"export_vector":true},
      "documents":{"create":true,"delete":true,"read":true,"read_public":true,"download_internal":true,"read_internal":true},
      "api_registry":{"create":true,"share":true,"read":true},
      "news":{"create":true,"update":true,"delete":true,"read":true,"read_public":true,"comment":true},
      "pdf_maps":{"create":true,"update":true,"delete":true,"read":true,"read_public":true,"download":true},
      "field_report":{"notify":true,"read":true,"stats":true},
      "hydro":{"edit_params":true,"run":true,"calibrate":true,"version":true,"import_export":true,"set_threshold":true,"read":true},
      "kttv":{"create_source":true,"test_source":true,"config_spatial":true,"config_temporal":true,"config_variables":true,"manage_stations":true,"schedule":true,"read":true},
      "map":{"view":true,"view_attributes":true,"search_feature":true,"view_3d":true,"view_legend":true,"locate":true,"route":true,"measure":true,"draw":true},
      "stats":{"view":true,"export":true},"spatial":{"analyze":true},"weather":{"read":true},
      "flood_forecast":{"read":true,"run":true}
    }'::jsonb, 10, true
),
(
    'ubnd_tp', 'UBND thành phố Cẩm Phả', 'Cẩm Phả City People''s Committee',
    'Khai thác dữ liệu, báo cáo, cảnh báo và nội dung theo phạm vi UBND thành phố Cẩm Phả.',
    'Uses data, reports, alerts, and content within Cẩm Phả City People''s Committee scope.',
    '{
      "users":{"read_own":true,"update_own":true},"layers":{"read":true},
      "raster":{"create":true,"delete":true,"categorize":true,"read":true,"compare":true,"search":true,"download":true,"classify":true,"export_vector":true},
      "documents":{"create":true,"delete":true,"read":true,"read_public":true,"download_internal":true,"read_internal":true},
      "api_registry":{"read":true},
      "news":{"create":true,"update":true,"delete":true,"read":true,"read_public":true,"comment":true},
      "pdf_maps":{"create":true,"update":true,"delete":true,"read":true,"read_public":true,"download":true},
      "field_report":{"notify":true,"read":true,"stats":true,"approve":true,"create":true,"measure":true},
      "hydro":{"read":true},"kttv":{"alarm_threshold":true,"read":true},
      "map":{"view":true,"view_attributes":true,"search_feature":true,"view_3d":true,"view_legend":true,"locate":true,"route":true,"measure":true,"draw":true},
      "stats":{"view":true,"export":true},"spatial":{"analyze":true},"weather":{"read":true},
      "flood_forecast":{"read":true,"run":true}
    }'::jsonb, 20, true
),
(
    'so_tnmt', 'Sở Tài nguyên và Môi trường Quảng Ninh', 'Quảng Ninh Department of Natural Resources and Environment',
    'Cơ quan nghiệp vụ cao nhất: quản lý tài khoản, dữ liệu GIS, KTTV và kịch bản thủy văn–thủy lực theo ma trận phân quyền.',
    'Primary business authority for accounts, GIS data, hydro-meteorological data, and hydrologic-hydraulic scenarios.',
    '{
      "users":{"read":true,"create":true,"delete":true,"change_status":true,"reset_password":true,"change_role":true,"read_own":true,"update_own":true},
      "layers":{"create":true,"read":true,"update":true,"delete":true,"grant":true},
      "raster":{"create":true,"delete":true,"categorize":true,"read":true,"compare":true,"search":true,"download":true,"classify":true,"export_vector":true},
      "documents":{"create":true,"delete":true,"read":true,"read_public":true,"download_internal":true,"read_internal":true},
      "api_registry":{"create":true,"share":true,"grant":true,"read":true},
      "news":{"create":true,"update":true,"delete":true,"read":true,"read_public":true,"comment":true},
      "pdf_maps":{"create":true,"update":true,"delete":true,"read":true,"read_public":true,"download":true},
      "field_report":{"notify":true,"read":true,"stats":true,"approve":true,"create":true,"measure":true},
      "hydro":{"edit_params":true,"run":true,"calibrate":true,"version":true,"import_export":true,"set_threshold":true,"publish_scenario":true,"read":true},
      "kttv":{"create_source":true,"test_source":true,"config_spatial":true,"config_temporal":true,"config_variables":true,"manage_stations":true,"schedule":true,"display_config":true,"alarm_threshold":true,"read":true},
      "map":{"view":true,"view_attributes":true,"search_feature":true,"view_3d":true,"view_legend":true,"locate":true,"route":true,"measure":true,"draw":true},
      "map_feature":{"update":true},"stats":{"view":true,"export":true},"spatial":{"analyze":true},"weather":{"read":true},
      "flood_forecast":{"read":true,"run":true}
    }'::jsonb, 30, true
),
(
    'so_xd', 'Sở Xây dựng Quảng Ninh', 'Quảng Ninh Department of Construction',
    'Quản lý nội dung, tài khoản trong đơn vị và tham gia nghiệp vụ mô hình; không sửa, xóa hoặc phân quyền lớp dữ liệu bản đồ.',
    'Manages content and in-scope accounts and participates in model operations; cannot edit, delete, or grant map-layer access.',
    '{
      "users":{"read":true,"create":true,"delete":true,"change_status":true,"reset_password":true,"read_own":true,"update_own":true},
      "layers":{"create":true,"read":true},
      "raster":{"create":true,"delete":true,"categorize":true,"read":true,"compare":true,"search":true,"download":true,"classify":true,"export_vector":true},
      "documents":{"create":true,"delete":true,"read":true,"read_public":true,"download_internal":true,"read_internal":true},
      "api_registry":{"create":true,"share":true,"read":true},
      "news":{"create":true,"update":true,"delete":true,"read":true,"read_public":true,"comment":true},
      "pdf_maps":{"create":true,"update":true,"delete":true,"read":true,"read_public":true,"download":true},
      "field_report":{"notify":true,"read":true,"stats":true,"approve":true,"create":true,"measure":true},
      "hydro":{"edit_params":true,"run":true,"calibrate":true,"version":true,"import_export":true,"set_threshold":true,"read":true},
      "kttv":{"create_source":true,"test_source":true,"config_spatial":true,"config_temporal":true,"config_variables":true,"manage_stations":true,"schedule":true,"read":true},
      "map":{"view":true,"view_attributes":true,"search_feature":true,"view_3d":true,"view_legend":true,"locate":true,"route":true,"measure":true,"draw":true},
      "stats":{"view":true,"export":true},"spatial":{"analyze":true},"weather":{"read":true},
      "flood_forecast":{"read":true,"run":true}
    }'::jsonb, 40, true
),
(
    'citizen', 'Người dân', 'Citizen',
    'Người dân Cẩm Phả tra cứu bản đồ, tin tức, dữ liệu công khai và gửi phản ánh hiện trường.',
    'Cẩm Phả citizens can view maps, news and public data and submit field reports.',
    '{
      "users":{"read_own":true,"update_own":true},
      "raster":{"compare":true,"search":true,"download":true,"classify":true,"export_vector":true},
      "documents":{"read_public":true},"news":{"read_public":true,"comment":true},
      "pdf_maps":{"read_public":true,"download":true},"field_report":{"create":true,"measure":true},
      "map":{"view":true,"view_attributes":true,"search_feature":true,"view_3d":true,"view_legend":true,"locate":true,"route":true,"measure":true,"draw":true},
      "stats":{"view":true,"export":true},"spatial":{"analyze":true},"weather":{"read":true},
      "flood_forecast":{"read":true}
    }'::jsonb, 50, true
)
ON CONFLICT (code) DO UPDATE SET
    name_vi = EXCLUDED.name_vi, name_en = EXCLUDED.name_en,
    description_vi = EXCLUDED.description_vi, description_en = EXCLUDED.description_en,
    permissions = EXCLUDED.permissions, sort_order = EXCLUDED.sort_order, is_active = true;

-- Đa tổ chức.
CREATE TABLE IF NOT EXISTS auth.organizations (
    id SERIAL PRIMARY KEY,
    code VARCHAR(30) UNIQUE NOT NULL,
    name_vi VARCHAR(200) NOT NULL,
    org_type VARCHAR(30) NOT NULL,
    parent_id INT REFERENCES auth.organizations(id),
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
DROP TRIGGER IF EXISTS trigger_organizations_updated_at ON auth.organizations;
CREATE TRIGGER trigger_organizations_updated_at BEFORE UPDATE ON auth.organizations
    FOR EACH ROW EXECUTE FUNCTION core.update_updated_at_column();

INSERT INTO auth.organizations (code, name_vi, org_type)
VALUES
    ('ubnd_campha', 'UBND thành phố Cẩm Phả', 'ubnd'),
    ('so_tnmt_qn', 'Sở Tài nguyên và Môi trường Quảng Ninh', 'so'),
    ('so_xd_qn', 'Sở Xây dựng Quảng Ninh', 'so'),
    ('van_hanh_campha', 'Đơn vị vận hành hệ thống Cẩm Phả', 'don_vi_van_hanh')
ON CONFLICT (code) DO UPDATE SET name_vi = EXCLUDED.name_vi, org_type = EXCLUDED.org_type, is_active = true;

ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS org_id INT REFERENCES auth.organizations(id);
CREATE INDEX IF NOT EXISTS idx_users_org_id ON auth.users(org_id) WHERE deleted_at IS NULL;

-- Chuẩn hóa tài khoản seed cũ nếu tồn tại.
UPDATE auth.users SET full_name = 'UBND thành phố Cẩm Phả'
WHERE LOWER(email) = 'ubnd@campha.gov.vn';
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM auth.users WHERE LOWER(email) = 'sonn@campha.gov.vn')
       AND NOT EXISTS (SELECT 1 FROM auth.users WHERE LOWER(email) = 'tnmt@campha.gov.vn') THEN
        UPDATE auth.users SET email = 'tnmt@campha.gov.vn',
            full_name = 'Sở Tài nguyên và Môi trường Quảng Ninh'
        WHERE LOWER(email) = 'sonn@campha.gov.vn';
    END IF;
END $$;

UPDATE auth.users u SET org_id = o.id FROM auth.roles r, auth.organizations o
WHERE u.role_id = r.id AND r.code = 'ubnd_tp' AND o.code = 'ubnd_campha' AND u.org_id IS NULL;
UPDATE auth.users u SET org_id = o.id FROM auth.roles r, auth.organizations o
WHERE u.role_id = r.id AND r.code = 'so_tnmt' AND o.code = 'so_tnmt_qn' AND u.org_id IS NULL;
UPDATE auth.users u SET org_id = o.id FROM auth.roles r, auth.organizations o
WHERE u.role_id = r.id AND r.code = 'so_xd' AND o.code = 'so_xd_qn' AND u.org_id IS NULL;
UPDATE auth.users u SET org_id = o.id FROM auth.roles r, auth.organizations o
WHERE u.role_id = r.id AND r.code = 'system_admin' AND o.code = 'van_hanh_campha' AND u.org_id IS NULL;
UPDATE auth.users u SET org_id = o.id FROM auth.roles r, auth.organizations o
WHERE u.role_id = r.id AND r.code = 'citizen' AND o.code = 'ubnd_campha' AND u.org_id IS NULL;

-- Nền danh mục lớp và ACL theo lớp.
CREATE SCHEMA IF NOT EXISTS gis;
CREATE TABLE IF NOT EXISTS gis.layers (
    id BIGSERIAL PRIMARY KEY,
    code VARCHAR(80) UNIQUE NOT NULL,
    name_vi VARCHAR(200) NOT NULL,
    category VARCHAR(50), geometry_type VARCHAR(20), srid INT NOT NULL DEFAULT 4326,
    storage_kind VARCHAR(20) NOT NULL DEFAULT 'postgis', table_name VARCHAR(80), object_key TEXT,
    geoserver_layer VARCHAR(120), style_name VARCHAR(80), min_zoom INT, max_zoom INT,
    legend_config JSONB NOT NULL DEFAULT '{}', metadata JSONB NOT NULL DEFAULT '{}',
    is_public BOOLEAN NOT NULL DEFAULT false, version INT NOT NULL DEFAULT 1,
    created_by BIGINT REFERENCES auth.users(id), deleted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
DROP TRIGGER IF EXISTS trigger_layers_updated_at ON gis.layers;
CREATE TRIGGER trigger_layers_updated_at BEFORE UPDATE ON gis.layers
    FOR EACH ROW EXECUTE FUNCTION core.update_updated_at_column();

CREATE TABLE IF NOT EXISTS gis.layer_permissions (
    layer_id BIGINT NOT NULL REFERENCES gis.layers(id) ON DELETE CASCADE,
    role_code VARCHAR(30) NOT NULL REFERENCES auth.roles(code) ON UPDATE CASCADE,
    can_view BOOLEAN NOT NULL DEFAULT false, can_export BOOLEAN NOT NULL DEFAULT false,
    can_edit BOOLEAN NOT NULL DEFAULT false, can_delete BOOLEAN NOT NULL DEFAULT false,
    PRIMARY KEY (layer_id, role_code)
);
CREATE INDEX IF NOT EXISTS idx_layer_permissions_role ON gis.layer_permissions(role_code);
