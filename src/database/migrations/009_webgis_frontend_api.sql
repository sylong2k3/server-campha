-- Sprint 4: WebGIS read APIs, Vietnamese feature search and basemap catalog.

CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_layers_name_vi_trgm
    ON gis.layers USING GIN (LOWER(name_vi) gin_trgm_ops)
    WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_layers_web_catalog
    ON gis.layers (is_public, publish_status, category, id)
    WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS gis.basemaps (
    id BIGSERIAL PRIMARY KEY,
    code VARCHAR(40) UNIQUE NOT NULL,
    name_vi VARCHAR(120) NOT NULL,
    provider VARCHAR(30) NOT NULL,
    url_template TEXT NOT NULL,
    attribution TEXT NOT NULL,
    min_zoom SMALLINT NOT NULL DEFAULT 0,
    max_zoom SMALLINT NOT NULL DEFAULT 19,
    requires_api_key BOOLEAN NOT NULL DEFAULT false,
    is_enabled BOOLEAN NOT NULL DEFAULT true,
    display_order SMALLINT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT ck_basemaps_code CHECK (code ~ '^[a-z][a-z0-9_-]{1,39}$'),
    CONSTRAINT ck_basemaps_provider CHECK (provider IN ('osm', 'google', 'bing', 'dosm', 'xyz')),
    CONSTRAINT ck_basemaps_url CHECK (url_template ~ '^https://'),
    CONSTRAINT ck_basemaps_zoom CHECK (min_zoom BETWEEN 0 AND 24 AND max_zoom BETWEEN 0 AND 24 AND min_zoom <= max_zoom)
);

DROP TRIGGER IF EXISTS trigger_basemaps_updated_at ON gis.basemaps;
CREATE TRIGGER trigger_basemaps_updated_at BEFORE UPDATE ON gis.basemaps
    FOR EACH ROW EXECUTE FUNCTION core.update_updated_at_column();

INSERT INTO gis.basemaps
    (code, name_vi, provider, url_template, attribution, min_zoom, max_zoom, requires_api_key, is_enabled, display_order)
VALUES
    ('osm_standard', 'OpenStreetMap', 'osm', 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
     '© OpenStreetMap contributors', 0, 19, false, true, 10)
ON CONFLICT (code) DO UPDATE SET
    name_vi = EXCLUDED.name_vi,
    provider = EXCLUDED.provider,
    url_template = EXCLUDED.url_template,
    attribution = EXCLUDED.attribution,
    min_zoom = EXCLUDED.min_zoom,
    max_zoom = EXCLUDED.max_zoom,
    requires_api_key = EXCLUDED.requires_api_key,
    is_enabled = EXCLUDED.is_enabled,
    display_order = EXCLUDED.display_order;
