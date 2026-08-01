-- Sprint 3: layer management, durable import queue and cleanup queue.

ALTER TABLE gis.layers
    ADD COLUMN IF NOT EXISTS source_file_id BIGINT REFERENCES core.file_objects(id),
    ADD COLUMN IF NOT EXISTS publish_status VARCHAR(20) NOT NULL DEFAULT 'pending',
    ADD COLUMN IF NOT EXISTS cleanup_status VARCHAR(20) NOT NULL DEFAULT 'none';

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_layers_code_safe') THEN
        ALTER TABLE gis.layers ADD CONSTRAINT ck_layers_code_safe
            CHECK (code ~ '^[a-z][a-z0-9_]{0,62}$');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_layers_table_name_safe') THEN
        ALTER TABLE gis.layers ADD CONSTRAINT ck_layers_table_name_safe
            CHECK (table_name IS NULL OR table_name ~ '^[a-z][a-z0-9_]{0,62}$');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_layers_storage_kind') THEN
        ALTER TABLE gis.layers ADD CONSTRAINT ck_layers_storage_kind
            CHECK (storage_kind IN ('postgis', 'geotiff_minio'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_layers_geometry_type') THEN
        ALTER TABLE gis.layers ADD CONSTRAINT ck_layers_geometry_type
            CHECK (geometry_type IS NULL OR geometry_type IN ('POINT', 'MULTIPOINT', 'LINESTRING', 'MULTILINESTRING', 'POLYGON', 'MULTIPOLYGON', 'RASTER'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_layers_srid_positive') THEN
        ALTER TABLE gis.layers ADD CONSTRAINT ck_layers_srid_positive CHECK (srid > 0);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_layers_zoom_range') THEN
        ALTER TABLE gis.layers ADD CONSTRAINT ck_layers_zoom_range
            CHECK ((min_zoom IS NULL OR min_zoom BETWEEN 0 AND 24)
               AND (max_zoom IS NULL OR max_zoom BETWEEN 0 AND 24)
               AND (min_zoom IS NULL OR max_zoom IS NULL OR min_zoom <= max_zoom));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_layers_publish_status') THEN
        ALTER TABLE gis.layers ADD CONSTRAINT ck_layers_publish_status
            CHECK (publish_status IN ('pending', 'published', 'failed', 'unpublished'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_layers_cleanup_status') THEN
        ALTER TABLE gis.layers ADD CONSTRAINT ck_layers_cleanup_status
            CHECK (cleanup_status IN ('none', 'queued', 'running', 'complete', 'failed'));
    END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_layers_active_table_name
    ON gis.layers (table_name) WHERE table_name IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_layers_active_updated
    ON gis.layers (updated_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_layers_search
    ON gis.layers (LOWER(name_vi), code, category) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_layers_source_file
    ON gis.layers (source_file_id) WHERE source_file_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS gis.layer_import_jobs (
    id BIGSERIAL PRIMARY KEY,
    import_type VARCHAR(20) NOT NULL CHECK (import_type IN ('shapefile', 'excel')),
    file_object_id BIGINT NOT NULL REFERENCES core.file_objects(id),
    owner_user_id BIGINT NOT NULL REFERENCES auth.users(id),
    org_id INT REFERENCES auth.organizations(id),
    input_payload JSONB NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'queued'
        CHECK (status IN ('queued', 'running', 'succeeded', 'failed')),
    progress SMALLINT NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
    attempt SMALLINT NOT NULL DEFAULT 0 CHECK (attempt >= 0),
    max_attempts SMALLINT NOT NULL DEFAULT 3 CHECK (max_attempts BETWEEN 1 AND 10),
    worker_id VARCHAR(120),
    lease_expires_at TIMESTAMPTZ,
    layer_id BIGINT REFERENCES gis.layers(id),
    feature_count BIGINT CHECK (feature_count IS NULL OR feature_count >= 0),
    geometry_type VARCHAR(20),
    source_srid INT,
    target_srid INT,
    error_code VARCHAR(80),
    error_message TEXT,
    started_at TIMESTAMPTZ,
    finished_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_layer_import_active_file
    ON gis.layer_import_jobs (file_object_id)
    WHERE status IN ('queued', 'running');
CREATE INDEX IF NOT EXISTS idx_layer_import_claim
    ON gis.layer_import_jobs (status, created_at, id)
    WHERE status IN ('queued', 'running');
CREATE INDEX IF NOT EXISTS idx_layer_import_owner
    ON gis.layer_import_jobs (owner_user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS gis.layer_import_errors (
    id BIGSERIAL PRIMARY KEY,
    job_id BIGINT NOT NULL REFERENCES gis.layer_import_jobs(id) ON DELETE CASCADE,
    source_row BIGINT,
    field_name VARCHAR(120),
    error_code VARCHAR(80) NOT NULL,
    message TEXT NOT NULL,
    details JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_layer_import_errors_job
    ON gis.layer_import_errors (job_id, source_row NULLS FIRST, id);

CREATE TABLE IF NOT EXISTS gis.layer_cleanup_jobs (
    id BIGSERIAL PRIMARY KEY,
    layer_id BIGINT NOT NULL REFERENCES gis.layers(id),
    status VARCHAR(20) NOT NULL DEFAULT 'queued'
        CHECK (status IN ('queued', 'running', 'succeeded', 'failed')),
    attempt SMALLINT NOT NULL DEFAULT 0 CHECK (attempt >= 0),
    max_attempts SMALLINT NOT NULL DEFAULT 5 CHECK (max_attempts BETWEEN 1 AND 20),
    worker_id VARCHAR(120),
    lease_expires_at TIMESTAMPTZ,
    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    error_message TEXT,
    started_at TIMESTAMPTZ,
    finished_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_layer_cleanup_active
    ON gis.layer_cleanup_jobs (layer_id)
    WHERE status IN ('queued', 'running');
CREATE INDEX IF NOT EXISTS idx_layer_cleanup_claim
    ON gis.layer_cleanup_jobs (status, next_attempt_at, created_at)
    WHERE status IN ('queued', 'running');

DROP TRIGGER IF EXISTS trigger_layer_import_jobs_updated_at ON gis.layer_import_jobs;
CREATE TRIGGER trigger_layer_import_jobs_updated_at
    BEFORE UPDATE ON gis.layer_import_jobs
    FOR EACH ROW EXECUTE FUNCTION core.update_updated_at_column();

DROP TRIGGER IF EXISTS trigger_layer_cleanup_jobs_updated_at ON gis.layer_cleanup_jobs;
CREATE TRIGGER trigger_layer_cleanup_jobs_updated_at
    BEFORE UPDATE ON gis.layer_cleanup_jobs
    FOR EACH ROW EXECUTE FUNCTION core.update_updated_at_column();
