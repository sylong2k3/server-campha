-- System administrators handle citizen field reports from the public web application.
UPDATE auth.roles
SET permissions = jsonb_set(
        COALESCE(permissions, '{}'::jsonb),
        '{field_report,approve}',
        'true'::jsonb,
        true
    ),
    updated_at = NOW()
WHERE code = 'system_admin';
