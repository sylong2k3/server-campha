-- Sprint 7: source registry and durable area statistics independent of GEE.
CREATE SCHEMA IF NOT EXISTS analytics;

CREATE TABLE IF NOT EXISTS analytics.data_sources (
    id BIGSERIAL PRIMARY KEY,
    layer_id BIGINT NOT NULL REFERENCES gis.layers(id),
    source_type VARCHAR(30) NOT NULL CHECK (source_type IN ('flood','residential','infrastructure','administrative_boundary')),
    observed_year SMALLINT CHECK (observed_year IS NULL OR observed_year BETWEEN 1900 AND 2200),
    observed_at TIMESTAMPTZ,
    geometry_column VARCHAR(63) NOT NULL DEFAULT 'geom' CHECK (geometry_column ~ '^[a-z][a-z0-9_]{0,62}$'),
    administrative_code_column VARCHAR(63) CHECK (administrative_code_column IS NULL OR administrative_code_column ~ '^[a-z][a-z0-9_]{0,62}$'),
    administrative_name_column VARCHAR(63) CHECK (administrative_name_column IS NULL OR administrative_name_column ~ '^[a-z][a-z0-9_]{0,62}$'),
    label_column VARCHAR(63) CHECK (label_column IS NULL OR label_column ~ '^[a-z][a-z0-9_]{0,62}$'),
    is_active BOOLEAN NOT NULL DEFAULT true,
    version INT NOT NULL DEFAULT 1 CHECK (version > 0),
    created_by BIGINT NOT NULL REFERENCES auth.users(id),
    updated_by BIGINT REFERENCES auth.users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK ((source_type='administrative_boundary') = (administrative_code_column IS NOT NULL AND administrative_name_column IS NOT NULL)),
    CHECK (source_type='administrative_boundary' OR observed_year IS NOT NULL OR observed_at IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_analytics_source_active
    ON analytics.data_sources(layer_id,source_type,COALESCE(observed_year,0),COALESCE(observed_at,'-infinity'::timestamptz))
    WHERE is_active=true;
CREATE INDEX IF NOT EXISTS idx_analytics_source_type_time
    ON analytics.data_sources(source_type,observed_year,observed_at) WHERE is_active=true;

CREATE TABLE IF NOT EXISTS analytics.area_statistics (
    source_id BIGINT NOT NULL REFERENCES analytics.data_sources(id) ON DELETE CASCADE,
    boundary_source_id BIGINT REFERENCES analytics.data_sources(id),
    administrative_code VARCHAR(120) NOT NULL DEFAULT '',
    administrative_name VARCHAR(300),
    label VARCHAR(300) NOT NULL DEFAULT '',
    area_m2 NUMERIC(24,2) NOT NULL CHECK (area_m2 >= 0),
    area_ha NUMERIC(24,4) NOT NULL CHECK (area_ha >= 0),
    feature_count BIGINT NOT NULL CHECK (feature_count >= 0),
    invalid_feature_count BIGINT NOT NULL DEFAULT 0 CHECK (invalid_feature_count >= 0),
    refreshed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY(source_id,administrative_code,label)
);
CREATE INDEX IF NOT EXISTS idx_area_stats_admin
    ON analytics.area_statistics(administrative_code,source_id);

DROP TRIGGER IF EXISTS trigger_analytics_sources_updated_at ON analytics.data_sources;
CREATE TRIGGER trigger_analytics_sources_updated_at BEFORE UPDATE ON analytics.data_sources
    FOR EACH ROW EXECUTE FUNCTION core.update_updated_at_column();