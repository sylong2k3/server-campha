-- Durable, retryable deletion of MinIO objects requested by entity DELETE APIs.
CREATE TABLE IF NOT EXISTS core.file_cleanup_jobs (
    id BIGSERIAL PRIMARY KEY,
    file_object_id BIGINT NOT NULL REFERENCES core.file_objects(id),
    requested_by BIGINT NOT NULL REFERENCES auth.users(id),
    source_type VARCHAR(40) NOT NULL CHECK (source_type IN (
        'satellite_image', 'layer', 'cms_document', 'cms_pdf_map', 'field_report', 'storage_object'
    )),
    source_id BIGINT NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'queued'
        CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'blocked')),
    attempt SMALLINT NOT NULL DEFAULT 0 CHECK (attempt >= 0),
    max_attempts SMALLINT NOT NULL DEFAULT 8 CHECK (max_attempts BETWEEN 1 AND 20),
    worker_id VARCHAR(120),
    lease_expires_at TIMESTAMPTZ,
    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    error_code VARCHAR(80),
    error_message TEXT,
    started_at TIMESTAMPTZ,
    finished_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_file_cleanup_active
    ON core.file_cleanup_jobs (file_object_id)
    WHERE status IN ('queued', 'running');
CREATE INDEX IF NOT EXISTS idx_file_cleanup_claim
    ON core.file_cleanup_jobs (status, next_attempt_at, created_at, id)
    WHERE status IN ('queued', 'running');
CREATE INDEX IF NOT EXISTS idx_file_cleanup_source
    ON core.file_cleanup_jobs (source_type, source_id, created_at DESC);

DROP TRIGGER IF EXISTS trigger_file_cleanup_jobs_updated_at ON core.file_cleanup_jobs;
CREATE TRIGGER trigger_file_cleanup_jobs_updated_at
    BEFORE UPDATE ON core.file_cleanup_jobs
    FOR EACH ROW EXECUTE FUNCTION core.update_updated_at_column();

-- Prevent a file from being attached after its deletion job has been committed.
-- Deferred constraint triggers plus the parent FK row lock close the concurrent
-- attach/enqueue race without adding a transient lifecycle state.
CREATE OR REPLACE FUNCTION core.prevent_file_cleanup_reference()
RETURNS TRIGGER AS $$
DECLARE
    target_file_id BIGINT;
    reference_mode TEXT := TG_ARGV[1];
BEGIN
    -- Deleted entities retain their source file ID for audit/history.
    IF reference_mode = 'soft_delete'
       AND NULLIF(to_jsonb(NEW) ->> 'deleted_at', '') IS NOT NULL THEN
        RETURN NEW;
    END IF;

    -- Finished import jobs retain their source file ID for diagnostics.
    IF reference_mode = 'active_import'
       AND COALESCE(to_jsonb(NEW) ->> 'status', '') NOT IN ('queued', 'running') THEN
        RETURN NEW;
    END IF;

    -- Photos only count while their parent report is active.
    IF reference_mode = 'active_report'
       AND NOT EXISTS (
           SELECT 1 FROM community.field_reports r
           WHERE r.id = NULLIF(to_jsonb(NEW) ->> 'report_id', '')::BIGINT
             AND r.deleted_at IS NULL
       ) THEN
        RETURN NEW;
    END IF;

    target_file_id := NULLIF(to_jsonb(NEW) ->> TG_ARGV[0], '')::BIGINT;
    IF target_file_id IS NOT NULL AND (
        EXISTS (
            SELECT 1 FROM core.file_cleanup_jobs j
            WHERE j.file_object_id = target_file_id AND j.status IN ('queued', 'running')
        )
        OR NOT EXISTS (
            SELECT 1 FROM core.file_objects f
            WHERE f.id = target_file_id
              AND f.lifecycle_status = 'ready'
              AND f.deleted_at IS NULL
        )
    ) THEN
        RAISE EXCEPTION USING
            ERRCODE = '23514',
            CONSTRAINT = 'file_cleanup_reference_guard',
            MESSAGE = 'File is pending deletion or already deleted';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_satellite_file_cleanup_guard ON raster.satellite_images;
CREATE CONSTRAINT TRIGGER trigger_satellite_file_cleanup_guard
    AFTER INSERT OR UPDATE ON raster.satellite_images
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
    EXECUTE FUNCTION core.prevent_file_cleanup_reference('file_object_id', 'soft_delete');

DROP TRIGGER IF EXISTS trigger_layer_file_cleanup_guard ON gis.layers;
CREATE CONSTRAINT TRIGGER trigger_layer_file_cleanup_guard
    AFTER INSERT OR UPDATE ON gis.layers
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
    EXECUTE FUNCTION core.prevent_file_cleanup_reference('source_file_id', 'soft_delete');

DROP TRIGGER IF EXISTS trigger_document_file_cleanup_guard ON cms.documents;
CREATE CONSTRAINT TRIGGER trigger_document_file_cleanup_guard
    AFTER INSERT OR UPDATE ON cms.documents
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
    EXECUTE FUNCTION core.prevent_file_cleanup_reference('file_object_id', 'soft_delete');

DROP TRIGGER IF EXISTS trigger_pdf_map_file_cleanup_guard ON cms.pdf_maps;
CREATE CONSTRAINT TRIGGER trigger_pdf_map_file_cleanup_guard
    AFTER INSERT OR UPDATE ON cms.pdf_maps
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
    EXECUTE FUNCTION core.prevent_file_cleanup_reference('file_object_id', 'soft_delete');

DROP TRIGGER IF EXISTS trigger_field_photo_file_cleanup_guard ON community.field_report_photos;
CREATE CONSTRAINT TRIGGER trigger_field_photo_file_cleanup_guard
    AFTER INSERT OR UPDATE ON community.field_report_photos
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
    EXECUTE FUNCTION core.prevent_file_cleanup_reference('file_object_id', 'active_report');

DROP TRIGGER IF EXISTS trigger_layer_import_file_cleanup_guard ON gis.layer_import_jobs;
CREATE CONSTRAINT TRIGGER trigger_layer_import_file_cleanup_guard
    AFTER INSERT OR UPDATE ON gis.layer_import_jobs
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
    EXECUTE FUNCTION core.prevent_file_cleanup_reference('file_object_id', 'active_import');
