-- Sprint 2: private object metadata and spatial reference contract.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM spatial_ref_sys
        WHERE srid = 5899 AND auth_name = 'EPSG' AND auth_srid = 5899
    ) THEN
        RAISE EXCEPTION 'Required CRS EPSG:5899 (VN-2000 / TM-3 107-45) is missing';
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS core.file_objects (
    id BIGSERIAL PRIMARY KEY,
    category VARCHAR(30) NOT NULL CHECK (category IN ('layers', 'raster', 'documents', 'field-photos')),
    bucket VARCHAR(63) NOT NULL,
    object_key TEXT NOT NULL,
    quarantine_key TEXT,
    owner_user_id BIGINT NOT NULL REFERENCES auth.users(id),
    org_id INT REFERENCES auth.organizations(id),
    original_name VARCHAR(255) NOT NULL,
    expected_mime VARCHAR(150),
    detected_mime VARCHAR(150),
    size_bytes BIGINT CHECK (size_bytes IS NULL OR size_bytes >= 0),
    sha256 CHAR(64),
    scan_status VARCHAR(20) NOT NULL DEFAULT 'pending'
        CHECK (scan_status IN ('pending', 'scanning', 'clean', 'infected', 'error')),
    lifecycle_status VARCHAR(20) NOT NULL DEFAULT 'quarantine'
        CHECK (lifecycle_status IN ('quarantine', 'ready', 'rejected', 'deleted')),
    expires_at TIMESTAMPTZ,
    ready_at TIMESTAMPTZ,
    deleted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (bucket, object_key),
    CHECK ((lifecycle_status = 'quarantine' AND quarantine_key IS NOT NULL)
        OR lifecycle_status <> 'quarantine')
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_file_objects_quarantine_key
    ON core.file_objects (quarantine_key) WHERE quarantine_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_file_objects_owner_status
    ON core.file_objects (owner_user_id, lifecycle_status);
CREATE INDEX IF NOT EXISTS idx_file_objects_expiry
    ON core.file_objects (expires_at) WHERE lifecycle_status = 'quarantine';

DROP TRIGGER IF EXISTS trigger_file_objects_updated_at ON core.file_objects;
CREATE TRIGGER trigger_file_objects_updated_at
    BEFORE UPDATE ON core.file_objects
    FOR EACH ROW EXECUTE FUNCTION core.update_updated_at_column();