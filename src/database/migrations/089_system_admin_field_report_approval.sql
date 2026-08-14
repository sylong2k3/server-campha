-- Allow system_admin to approve/review field reports directly, alongside the
-- ubnd_tp/so_tnmt/so_xd reviewers granted approve in migration 023.
UPDATE auth.roles
SET permissions = jsonb_set(
        COALESCE(permissions, '{}'::jsonb),
        '{field_report,approve}',
        'true'::jsonb,
        true
    ),
    updated_at = NOW()
WHERE code = 'system_admin';
