-- Grant every permission currently defined in the role catalog to system_admin.
-- Keep DB-backed authorization, validation, audit and concurrency checks intact.
-- ponytail: New permission migrations must also grant their keys to system_admin.
WITH actions AS (
    SELECT resource.key AS resource, action.key AS action
    FROM auth.roles r
    CROSS JOIN LATERAL jsonb_each(COALESCE(r.permissions, '{}'::jsonb)) resource
    CROSS JOIN LATERAL jsonb_each(resource.value) action
    UNION SELECT 'map_feature', 'read'
    UNION SELECT 'map_feature', 'update'
), resources AS (
    SELECT resource, jsonb_object_agg(action, true) AS permissions
    FROM (SELECT DISTINCT resource, action FROM actions) keys
    GROUP BY resource
)
UPDATE auth.roles
SET permissions = (SELECT jsonb_object_agg(resource, permissions) FROM resources),
    description_vi = 'Toàn quyền chức năng và dữ liệu hệ thống; vẫn áp dụng kiểm tra an toàn dữ liệu.',
    description_en = 'All system and data permissions; data safety checks still apply.',
    updated_at = NOW()
WHERE code = 'system_admin';

-- Cover every layer creation path, including raster workers and direct imports.
CREATE OR REPLACE FUNCTION gis.grant_system_admin_layer_access()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    INSERT INTO gis.layer_permissions
        (layer_id, role_code, can_view, can_export, can_edit, can_delete)
    SELECT id, 'system_admin', true, true, true, true
    FROM gis.layers WHERE id = NEW.id
    ON CONFLICT (layer_id, role_code) DO UPDATE
    SET can_view = true, can_export = true, can_edit = true, can_delete = true;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_layers_system_admin_access ON gis.layers;
-- Defer until commit so existing importers can insert their own ACL first.
CREATE CONSTRAINT TRIGGER trigger_layers_system_admin_access
    AFTER INSERT ON gis.layers
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION gis.grant_system_admin_layer_access();

INSERT INTO gis.layer_permissions
    (layer_id, role_code, can_view, can_export, can_edit, can_delete)
SELECT id, 'system_admin', true, true, true, true
FROM gis.layers
WHERE deleted_at IS NULL
ON CONFLICT (layer_id, role_code) DO UPDATE
SET can_view = true, can_export = true, can_edit = true, can_delete = true;
