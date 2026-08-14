-- Re-assert flood permissions on the seeded roles.
--
-- Symptom that motivated this migration: on some environments the flood
-- submit button was blocked because `auth.roles.permissions` did not carry
-- the `flood` key, or carried it without `run`. Migration 082 already grants
-- these, but the grant is easily lost when an operator merges a fresh
-- `002_campha_foundation` seed (which uses `flood_forecast` — a legacy key)
-- over an existing role row, or when a role was created after 082 ran.
--
-- This migration is idempotent: `jsonb_set` with `create_missing=true` sets
-- the `flood` sub-object outright. Running it repeatedly leaves the same
-- final state. It does not touch other permission keys.
--
-- Keys mirror server middleware:
--   flood.read      → GET /admin/flood/{dashboard,config,queue,runs,runs/:id}
--   flood.run       → POST /admin/flood/runs, /runs/:id/rerun, /runs/:id/cancel
--   flood.calibrate → run.mode='calibration' guard in analysis.service
--   flood.publish   → POST /admin/flood/artifacts/:id/{publish,unpublish}
--   flood.configure → reserved for future config write endpoints

UPDATE auth.roles
SET permissions = jsonb_set(
    COALESCE(permissions, '{}'::jsonb),
    '{flood}',
    '{"read":true,"run":true,"calibrate":true,"publish":true,"configure":true}'::jsonb,
    true
)
WHERE code IN ('system_admin', 'so_tnmt');

UPDATE auth.roles
SET permissions = jsonb_set(
    COALESCE(permissions, '{}'::jsonb),
    '{flood}',
    '{"read":true,"run":true}'::jsonb,
    true
)
WHERE code IN ('ubnd_tp', 'so_xd');

UPDATE auth.roles
SET permissions = jsonb_set(
    COALESCE(permissions, '{}'::jsonb),
    '{flood}',
    '{"read":true}'::jsonb,
    true
)
WHERE code = 'citizen';
