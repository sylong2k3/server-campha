-- GEE-S05: Flood/Hydrology domain — analysis runs, artifacts, stage events, manual audit.
-- See @docs/GEE_FLOOD_INTEGRATION_ARCHITECTURE.md §7.1.

-- ── flood_analysis_runs ────────────────────────────────────────────────────
-- One row per attempt. Re-run creates a new row with the same analysis_key
-- and an incremented attempt_no (§47 immutability rule).
CREATE TABLE IF NOT EXISTS gis.flood_analysis_runs (
    id                  BIGSERIAL PRIMARY KEY,
    analysis_key        TEXT NOT NULL,
    attempt_no          INTEGER NOT NULL DEFAULT 1 CHECK (attempt_no >= 1),
    module              TEXT NOT NULL CHECK (module IN ('event', 'hand', 'rain', 'impact', 'trend')),
    mode                TEXT NOT NULL CHECK (mode IN ('product', 'calibration')),
    status              TEXT NOT NULL CHECK (status IN (
        'QUEUED','COMPUTING','EXPORTING','HARVESTING','VALIDATING',
        'ARCHIVING','PUBLISHING','SUCCEEDED','FAILED','CANCELLED','DLQ'
    )),
    stage               TEXT,
    pipeline_version    TEXT NOT NULL,
    config_version      TEXT NOT NULL,
    params_snapshot     JSONB NOT NULL CHECK (jsonb_typeof(params_snapshot) = 'object'),
    aoi_source          TEXT NOT NULL CHECK (aoi_source IN ('REFERENCE_GAUL', 'AUTHORITATIVE')),
    started_by          BIGINT REFERENCES auth.users(id),
    gee_task_ids        JSONB CHECK (gee_task_ids IS NULL OR jsonb_typeof(gee_task_ids) = 'object'),
    warnings            JSONB CHECK (warnings IS NULL OR jsonb_typeof(warnings) = 'array'),
    error_code          TEXT,
    error_message_safe  TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    started_at          TIMESTAMPTZ,
    finished_at         TIMESTAMPTZ,
    UNIQUE (analysis_key, attempt_no)
);
CREATE INDEX IF NOT EXISTS idx_flood_runs_status ON gis.flood_analysis_runs (status);
CREATE INDEX IF NOT EXISTS idx_flood_runs_module_created ON gis.flood_analysis_runs (module, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_flood_runs_started_by ON gis.flood_analysis_runs (started_by) WHERE started_by IS NOT NULL;

-- ── flood_artifacts ────────────────────────────────────────────────────────
-- One row per raster / metric artifact produced by a run.
CREATE TABLE IF NOT EXISTS gis.flood_artifacts (
    id                  BIGSERIAL PRIMARY KEY,
    analysis_run_id     BIGINT NOT NULL REFERENCES gis.flood_analysis_runs(id) ON DELETE CASCADE,
    module              TEXT NOT NULL CHECK (module IN ('event', 'hand', 'rain', 'impact', 'trend')),
    artifact_code       TEXT NOT NULL,
    artifact_role       TEXT NOT NULL CHECK (artifact_role IN ('PRODUCT', 'QA', 'CALIBRATION')),
    pipeline_version    TEXT NOT NULL,
    gcs_bucket          TEXT,
    gcs_object          TEXT,
    minio_bucket        TEXT,
    minio_object_key    TEXT,
    checksum_sha256     TEXT CHECK (checksum_sha256 IS NULL OR checksum_sha256 ~ '^[0-9a-f]{64}$'),
    size_bytes          BIGINT CHECK (size_bytes IS NULL OR size_bytes >= 0),
    content_type        TEXT,
    crs                 TEXT,
    width               INTEGER,
    height              INTEGER,
    resolution_m        NUMERIC,
    nodata              NUMERIC,
    bbox                JSONB CHECK (bbox IS NULL OR jsonb_typeof(bbox) = 'object'),
    band_count          INTEGER,
    data_type           TEXT,
    workspace           TEXT,
    coverage_store      TEXT,
    layer_name          TEXT,
    style_name          TEXT,
    publish_status      TEXT NOT NULL DEFAULT 'unpublished'
        CHECK (publish_status IN ('unpublished', 'publishing', 'published', 'failed')),
    published_at        TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_flood_artifacts_run ON gis.flood_artifacts (analysis_run_id);
CREATE INDEX IF NOT EXISTS idx_flood_artifacts_layer ON gis.flood_artifacts (workspace, layer_name)
    WHERE workspace IS NOT NULL AND layer_name IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_flood_artifacts_publish_status ON gis.flood_artifacts (publish_status);
-- One artifact code per run — a re-run creates a NEW run row (§39).
CREATE UNIQUE INDEX IF NOT EXISTS uq_flood_artifacts_run_code
    ON gis.flood_artifacts (analysis_run_id, artifact_code);

-- ── flood_run_stage_events ─────────────────────────────────────────────────
-- Structured stage-log records (§74 observability).
CREATE TABLE IF NOT EXISTS gis.flood_run_stage_events (
    id                  BIGSERIAL PRIMARY KEY,
    analysis_run_id     BIGINT NOT NULL REFERENCES gis.flood_analysis_runs(id) ON DELETE CASCADE,
    stage               TEXT NOT NULL,
    event_type          TEXT NOT NULL CHECK (event_type IN ('stage_start', 'stage_end', 'stage_error', 'stage_warn')),
    elapsed_ms          INTEGER CHECK (elapsed_ms IS NULL OR elapsed_ms >= 0),
    attempt_no          INTEGER NOT NULL DEFAULT 1 CHECK (attempt_no >= 1),
    detail              JSONB CHECK (detail IS NULL OR jsonb_typeof(detail) = 'object'),
    emitted_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_flood_stage_events_run
    ON gis.flood_run_stage_events (analysis_run_id, emitted_at);

-- ── flood_run_audit ────────────────────────────────────────────────────────
-- Manual actions taken by admins (submit / rerun / cancel / publish / etc).
CREATE TABLE IF NOT EXISTS gis.flood_run_audit (
    id                  BIGSERIAL PRIMARY KEY,
    analysis_run_id     BIGINT REFERENCES gis.flood_analysis_runs(id),
    artifact_id         BIGINT REFERENCES gis.flood_artifacts(id),
    actor_user_id       BIGINT REFERENCES auth.users(id),
    action              TEXT NOT NULL CHECK (action IN (
        'submit', 'rerun', 'cancel', 'publish', 'unpublish', 'retry_publish', 'discard_artifact'
    )),
    metadata            JSONB CHECK (metadata IS NULL OR jsonb_typeof(metadata) = 'object'),
    ip                  INET,
    user_agent          TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_flood_run_audit_run
    ON gis.flood_run_audit (analysis_run_id, created_at DESC) WHERE analysis_run_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_flood_run_audit_actor
    ON gis.flood_run_audit (actor_user_id, created_at DESC) WHERE actor_user_id IS NOT NULL;
