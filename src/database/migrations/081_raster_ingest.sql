-- GEE-S05: Raster ingest job queue + DLQ (§22-D improvement over reference).
-- Consumed by services/raster-ingest.* modules ported in GEE-S04.

-- ── raster_ingest_jobs ─────────────────────────────────────────────────────
-- State machine (see architecture doc §33):
--   pending → downloading → validating → uploading → publishing → completed
--   pending → url_expired  (HTTP 401; awaiting refresh)
--   any     → failed       (transient; caller may re-queue up to MAX_RETRIES)
--   any     → dlq          (§22-D — final terminal state after MAX_RETRIES)
CREATE TABLE IF NOT EXISTS gis.raster_ingest_jobs (
    id                    BIGSERIAL PRIMARY KEY,
    layer_code            VARCHAR(80) NOT NULL CHECK (layer_code ~ '^[a-z][a-z0-9_-]{1,58}$'),
    source_kind           VARCHAR(40) NOT NULL DEFAULT 'gee_download_url'
        CHECK (source_kind IN ('gee_download_url', 'gcs_export')),
    source_url            TEXT NOT NULL CHECK (source_url ~ '^https?://'),
    -- SHA-256 of the source URL — dedupe key (see raster-ingest.enqueue.js).
    source_hash           CHAR(64) NOT NULL CHECK (source_hash ~ '^[0-9a-f]{64}$'),
    request_params        JSONB NOT NULL DEFAULT '{}'::jsonb
        CHECK (jsonb_typeof(request_params) = 'object'),
    status                VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN (
        'pending', 'downloading', 'validating', 'uploading', 'publishing',
        'completed', 'failed', 'url_expired', 'dlq'
    )),
    progress              SMALLINT NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
    retry_count           SMALLINT NOT NULL DEFAULT 0 CHECK (retry_count >= 0),
    -- Backoff scheduling. Workers claim jobs where NOW() >= next_attempt_at.
    next_attempt_at       TIMESTAMPTZ,
    error_log             TEXT,
    -- Populated when the pipeline completes stage 6 (registry upsert).
    minio_category        VARCHAR(40),
    minio_key             TEXT,
    file_size_bytes       BIGINT CHECK (file_size_bytes IS NULL OR file_size_bytes >= 0),
    file_sha256           CHAR(64) CHECK (file_sha256 IS NULL OR file_sha256 ~ '^[0-9a-f]{64}$'),
    geoserver_store       VARCHAR(120),
    geoserver_layer       VARCHAR(160),
    layer_id              BIGINT,
    created_by            BIGINT REFERENCES auth.users(id),
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at          TIMESTAMPTZ
);

-- Fast dedupe lookup by source hash (enqueue.js hot path).
CREATE UNIQUE INDEX IF NOT EXISTS uq_raster_ingest_active_hash
    ON gis.raster_ingest_jobs (source_hash)
    WHERE status IN ('pending', 'downloading', 'validating', 'uploading', 'publishing');

-- Fast layer_code dedupe (advisory-lock transaction path).
CREATE INDEX IF NOT EXISTS idx_raster_ingest_active_layer
    ON gis.raster_ingest_jobs (layer_code)
    WHERE status IN ('pending', 'downloading', 'validating', 'uploading', 'publishing');

-- claimPending() query support: SELECT ... WHERE status='pending' AND next_attempt_at <= NOW()
-- ORDER BY id FOR UPDATE SKIP LOCKED.
CREATE INDEX IF NOT EXISTS idx_raster_ingest_claim
    ON gis.raster_ingest_jobs (status, next_attempt_at NULLS FIRST, id)
    WHERE status = 'pending';

-- Layered index for admin browsing.
CREATE INDEX IF NOT EXISTS idx_raster_ingest_layer_created
    ON gis.raster_ingest_jobs (layer_code, created_at DESC);

-- keep updated_at fresh
DROP TRIGGER IF EXISTS trigger_raster_ingest_updated_at ON gis.raster_ingest_jobs;
CREATE TRIGGER trigger_raster_ingest_updated_at
    BEFORE UPDATE ON gis.raster_ingest_jobs
    FOR EACH ROW EXECUTE FUNCTION core.update_updated_at_column();

-- ── raster_ingest_dlq ──────────────────────────────────────────────────────
-- Terminal-state history for jobs that exhausted retries or hit a
-- non-retryable failure. Admin can inspect + selectively re-enqueue.
CREATE TABLE IF NOT EXISTS gis.raster_ingest_dlq (
    id                  BIGSERIAL PRIMARY KEY,
    job_id              BIGINT NOT NULL REFERENCES gis.raster_ingest_jobs(id) ON DELETE CASCADE,
    reason              VARCHAR(40) NOT NULL CHECK (reason IN (
        'MAX_RETRIES_EXCEEDED', 'NON_RETRYABLE', 'INTERRUPTED_ON_RESTART',
        'INVALID_ARTIFACT', 'UNSUPPORTED_CRS', 'MANUAL_DISCARD'
    )),
    error_log           TEXT,
    detail              JSONB CHECK (detail IS NULL OR jsonb_typeof(detail) = 'object'),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    resolved_at         TIMESTAMPTZ,
    resolved_by         BIGINT REFERENCES auth.users(id),
    resolution          VARCHAR(20) CHECK (resolution IS NULL OR resolution IN ('retry', 'discard'))
);
CREATE INDEX IF NOT EXISTS idx_raster_ingest_dlq_open
    ON gis.raster_ingest_dlq (created_at DESC) WHERE resolved_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_raster_ingest_dlq_job ON gis.raster_ingest_dlq (job_id);
