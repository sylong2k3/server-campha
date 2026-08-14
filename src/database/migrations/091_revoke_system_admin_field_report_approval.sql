-- Revert 089: system_admin should not approve/review field reports.
-- field-report.service.js only allows ubnd_tp/so_tnmt/so_xd as reviewers; keep
-- the DB permission in sync rather than widening the app-level reviewer list.
UPDATE auth.roles
SET permissions = permissions #- '{field_report,approve}',
    updated_at = NOW()
WHERE code = 'system_admin';
