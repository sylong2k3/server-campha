-- Sprint 6a: satellite image catalog and thematic classification.
CREATE SCHEMA IF NOT EXISTS raster;

CREATE TABLE IF NOT EXISTS raster.satellite_images (
    id BIGSERIAL PRIMARY KEY,
    scene_code VARCHAR(150) NOT NULL CHECK (char_length(btrim(scene_code)) BETWEEN 1 AND 150),
    title VARCHAR(300) NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 300),
    platform VARCHAR(20) NOT NULL CHECK (platform IN ('sentinel-1','sentinel-2','landsat-7','landsat-8')),
    thematic_group VARCHAR(80) CHECK (thematic_group IS NULL OR char_length(btrim(thematic_group)) BETWEEN 1 AND 80),
    coverage_key VARCHAR(120) NOT NULL CHECK (coverage_key ~ '^[a-z0-9][a-z0-9_-]{1,119}$'),
    acquired_at TIMESTAMPTZ NOT NULL,
    product_level VARCHAR(50),
    resolution_m NUMERIC(8,2) CHECK (resolution_m IS NULL OR resolution_m > 0),
    cloud_cover_percent NUMERIC(5,2) CHECK (cloud_cover_percent IS NULL OR cloud_cover_percent BETWEEN 0 AND 100),
    orbit_number INTEGER CHECK (orbit_number IS NULL OR orbit_number > 0),
    description TEXT CHECK (description IS NULL OR char_length(description) <= 5000),
    file_object_id BIGINT NOT NULL UNIQUE REFERENCES core.file_objects(id),
    created_by BIGINT NOT NULL REFERENCES auth.users(id),
    updated_by BIGINT REFERENCES auth.users(id),
    deleted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_satellite_scene_active
    ON raster.satellite_images (lower(scene_code)) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_satellite_acquired
    ON raster.satellite_images (acquired_at DESC, id DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_satellite_platform_group
    ON raster.satellite_images (platform, thematic_group, acquired_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_satellite_coverage
    ON raster.satellite_images (coverage_key, acquired_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_satellite_title_trgm
    ON raster.satellite_images USING gin (title gin_trgm_ops) WHERE deleted_at IS NULL;

DROP TRIGGER IF EXISTS trigger_satellite_images_updated_at ON raster.satellite_images;
CREATE TRIGGER trigger_satellite_images_updated_at BEFORE UPDATE ON raster.satellite_images
    FOR EACH ROW EXECUTE FUNCTION core.update_updated_at_column();