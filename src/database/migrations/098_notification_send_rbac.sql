-- Administrative notification delivery endpoint.
-- Sending to all users is a privileged operation; keep the grant explicit.
UPDATE auth.roles
SET permissions = jsonb_set(
    COALESCE(permissions, '{}'::jsonb),
    '{notifications}',
    COALESCE(permissions->'notifications', '{}'::jsonb) || '{"send":true}'::jsonb,
    true
)
WHERE code IN ('system_admin', 'so_tnmt');
