-- Flood runtime metadata, durable artifact link and role permissions.

ALTER TABLE gis.flood_analysis_runs
    ADD COLUMN IF NOT EXISTS result_metadata JSONB
        CHECK (result_metadata IS NULL OR jsonb_typeof(result_metadata) = 'object');

ALTER TABLE gis.flood_artifacts
    ADD COLUMN IF NOT EXISTS ingest_job_id BIGINT REFERENCES gis.raster_ingest_jobs(id),
    ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb
        CHECK (jsonb_typeof(metadata) = 'object');

CREATE INDEX IF NOT EXISTS idx_flood_artifacts_ingest_job
    ON gis.flood_artifacts (ingest_job_id) WHERE ingest_job_id IS NOT NULL;

-- Close the check-then-insert race between two admin clicks or replicas.
-- Terminal attempts remain immutable and may share the same analysis_key.
CREATE UNIQUE INDEX IF NOT EXISTS uq_flood_runs_one_live_analysis_key
    ON gis.flood_analysis_runs (analysis_key)
    WHERE status IN (
        'QUEUED','COMPUTING','EXPORTING','HARVESTING',
        'VALIDATING','ARCHIVING','PUBLISHING'
    );

-- The server authorizes from auth.roles.permissions; there is no implicit
-- system-admin bypass. Keep the grant explicit and auditable.
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
