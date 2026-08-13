-- Add the missing document metadata update action to CMS manager roles.
-- Authorization reads auth.roles.permissions directly; keep this grant explicit.
UPDATE auth.roles
SET permissions = jsonb_set(
        COALESCE(permissions, '{}'::jsonb),
        '{documents,update}',
        'true'::jsonb,
        true
    ),
    updated_at = NOW()
WHERE code IN ('system_admin', 'ubnd_tp', 'so_tnmt', 'so_xd');
