-- Migration 106: Cấp toàn quyền cho system_admin, bỏ tất cả ngoại lệ trước đây.
--
-- Migration 098 đã thu hồi 6 quyền:
--   users.change_role, layers.update, layers.delete, layers.grant,
--   api_registry.grant, map_feature.update
--
-- Migration này cấp lại 6 quyền đó. Kết hợp với bypass trong
-- auth.middleware.js (role === 'system_admin' → skip requirePermission),
-- admin có đầy đủ quyền trên cả server lẫn frontend.
--
-- Idempotent: jsonb_set với create_missing=true, chạy lại an toàn.

UPDATE auth.roles
SET permissions =
        jsonb_set(
        jsonb_set(
        jsonb_set(
        jsonb_set(
        jsonb_set(
        jsonb_set(
            COALESCE(permissions, '{}'::jsonb),
            '{users,change_role}', 'true'::jsonb, true
        ),
            '{layers,update}', 'true'::jsonb, true
        ),
            '{layers,delete}', 'true'::jsonb, true
        ),
            '{layers,grant}', 'true'::jsonb, true
        ),
            '{api_registry,grant}', 'true'::jsonb, true
        ),
            '{map_feature,update}', 'true'::jsonb, true
        ),
    description_vi = 'Toàn quyền truy cập hệ thống Cẩm Phả, không có ngoại lệ.',
    description_en = 'Full unrestricted access to the Cẩm Phả system.',
    updated_at     = NOW()
WHERE code = 'system_admin';
