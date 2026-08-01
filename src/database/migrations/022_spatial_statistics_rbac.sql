-- Sprint 7 RBAC correction: citizens may view statistics but cannot export or run spatial analysis.
UPDATE auth.roles
SET permissions = jsonb_set(permissions #- '{stats,export}', '{spatial}', COALESCE(permissions->'spatial','{}'::jsonb) - 'analyze', true),
    updated_at = NOW()
WHERE code = 'citizen';