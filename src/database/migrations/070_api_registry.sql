-- Sprint 13: scoped layer API registry, revocable share keys, PostgreSQL quota and immutable audit.
CREATE SCHEMA IF NOT EXISTS apikey;

CREATE TABLE IF NOT EXISTS apikey.registries (
 id BIGSERIAL PRIMARY KEY, layer_id BIGINT NOT NULL REFERENCES gis.layers(id), slug VARCHAR(80) NOT NULL, name VARCHAR(200) NOT NULL,
 read_fields VARCHAR(63)[] NOT NULL, write_fields VARCHAR(63)[] NOT NULL DEFAULT '{}', search_fields VARCHAR(63)[] NOT NULL DEFAULT '{}',
 allowed_methods VARCHAR(10)[] NOT NULL DEFAULT ARRAY['GET'], default_sort_field VARCHAR(63) NOT NULL, is_active BOOLEAN NOT NULL DEFAULT true,
 version BIGINT NOT NULL DEFAULT 1 CHECK(version>=1), created_by BIGINT NOT NULL REFERENCES auth.users(id), updated_by BIGINT NOT NULL REFERENCES auth.users(id),
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), deleted_at TIMESTAMPTZ,
 CHECK(slug~'^[a-z][a-z0-9-]{2,79}$'), CHECK(cardinality(read_fields) BETWEEN 1 AND 50), CHECK(cardinality(write_fields)<=30),
 CHECK(cardinality(search_fields)<=10), CHECK(cardinality(allowed_methods) BETWEEN 1 AND 4),
 CHECK(allowed_methods<@ARRAY['GET','POST','PUT','DELETE']::varchar[]), CHECK('GET'=ANY(allowed_methods))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_api_registries_active_layer ON apikey.registries(layer_id) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_api_registries_active_slug ON apikey.registries(slug) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_api_registries_list ON apikey.registries(is_active,created_at DESC) WHERE deleted_at IS NULL;
DROP TRIGGER IF EXISTS trigger_api_registries_updated_at ON apikey.registries;
CREATE TRIGGER trigger_api_registries_updated_at BEFORE UPDATE ON apikey.registries FOR EACH ROW EXECUTE FUNCTION core.update_updated_at_column();

CREATE TABLE IF NOT EXISTS apikey.keys (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), registry_id BIGINT NOT NULL REFERENCES apikey.registries(id), name VARCHAR(120) NOT NULL, consumer VARCHAR(200) NOT NULL,
 jti_hash CHAR(64) NOT NULL UNIQUE, token_version INTEGER NOT NULL DEFAULT 1 CHECK(token_version>=1), token_hint VARCHAR(8) NOT NULL,
 scopes VARCHAR(30)[] NOT NULL DEFAULT ARRAY['features:read'], quota_per_minute INTEGER NOT NULL CHECK(quota_per_minute BETWEEN 1 AND 1000),
 expires_at TIMESTAMPTZ NOT NULL, created_by BIGINT NOT NULL REFERENCES auth.users(id), approved_by BIGINT REFERENCES auth.users(id), created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 rotated_at TIMESTAMPTZ, rotated_by BIGINT REFERENCES auth.users(id), revoked_at TIMESTAMPTZ, revoked_by BIGINT REFERENCES auth.users(id),
 CHECK(expires_at>created_at), CHECK(cardinality(scopes) BETWEEN 1 AND 4),
 CHECK(scopes<@ARRAY['features:read','features:create','features:update','features:delete']::varchar[]), CHECK('features:read'=ANY(scopes))
);
CREATE INDEX IF NOT EXISTS idx_api_keys_registry ON apikey.keys(registry_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_api_keys_active ON apikey.keys(expires_at) WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS apikey.quota_windows (
 key_id UUID NOT NULL REFERENCES apikey.keys(id) ON DELETE CASCADE, window_start TIMESTAMPTZ NOT NULL,
 request_count INTEGER NOT NULL DEFAULT 1 CHECK(request_count>=1), PRIMARY KEY(key_id,window_start)
);
CREATE INDEX IF NOT EXISTS idx_api_quota_cleanup ON apikey.quota_windows(window_start);

CREATE TABLE IF NOT EXISTS apikey.call_logs (
 id BIGSERIAL PRIMARY KEY, registry_id BIGINT NOT NULL REFERENCES apikey.registries(id), key_id UUID NOT NULL REFERENCES apikey.keys(id),
 method VARCHAR(10) NOT NULL, path VARCHAR(500) NOT NULL, status_code INTEGER NOT NULL CHECK(status_code BETWEEN 100 AND 599),
 duration_ms INTEGER NOT NULL CHECK(duration_ms>=0), ip_address INET, user_agent VARCHAR(500), row_count INTEGER CHECK(row_count IS NULL OR row_count>=0),
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_api_call_logs_registry_time ON apikey.call_logs(registry_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_api_call_logs_key_time ON apikey.call_logs(key_id,created_at DESC);

CREATE TABLE IF NOT EXISTS apikey.key_events (
 id BIGSERIAL PRIMARY KEY, key_id UUID NOT NULL REFERENCES apikey.keys(id), event VARCHAR(20) NOT NULL CHECK(event IN('issued','rotated','revoked')),
 actor_user_id BIGINT NOT NULL REFERENCES auth.users(id), metadata JSONB NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(metadata)='object'), created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_api_key_events_key_time ON apikey.key_events(key_id,created_at DESC);

ALTER TABLE gis.feature_versions ADD COLUMN IF NOT EXISTS api_key_id UUID REFERENCES apikey.keys(id);

CREATE TABLE IF NOT EXISTS apikey.feature_mutations (
 id BIGSERIAL PRIMARY KEY, registry_id BIGINT NOT NULL REFERENCES apikey.registries(id), key_id UUID NOT NULL REFERENCES apikey.keys(id),
 layer_id BIGINT NOT NULL REFERENCES gis.layers(id), feature_id VARCHAR(120) NOT NULL, version BIGINT NOT NULL CHECK(version>=1),
 action VARCHAR(10) NOT NULL CHECK(action IN('create','delete')), before_attributes JSONB, after_attributes JSONB,
 before_geom geometry(Geometry,4326), after_geom geometry(Geometry,4326), actor_user_id BIGINT NOT NULL REFERENCES auth.users(id), created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 CHECK(before_attributes IS NULL OR jsonb_typeof(before_attributes)='object'), CHECK(after_attributes IS NULL OR jsonb_typeof(after_attributes)='object'),
 CHECK((action='create' AND before_attributes IS NULL AND before_geom IS NULL AND after_attributes IS NOT NULL AND after_geom IS NOT NULL)
 OR (action='delete' AND before_attributes IS NOT NULL AND before_geom IS NOT NULL AND after_attributes IS NULL AND after_geom IS NULL))
);
CREATE INDEX IF NOT EXISTS idx_api_feature_mutations_history ON apikey.feature_mutations(layer_id,feature_id,version DESC);

CREATE OR REPLACE FUNCTION apikey.reject_audit_mutation() RETURNS TRIGGER AS $$ BEGIN RAISE EXCEPTION 'API registry audit records are immutable'; END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trigger_api_call_logs_immutable ON apikey.call_logs;
CREATE TRIGGER trigger_api_call_logs_immutable BEFORE UPDATE OR DELETE ON apikey.call_logs FOR EACH ROW EXECUTE FUNCTION apikey.reject_audit_mutation();
DROP TRIGGER IF EXISTS trigger_api_key_events_immutable ON apikey.key_events;
CREATE TRIGGER trigger_api_key_events_immutable BEFORE UPDATE OR DELETE ON apikey.key_events FOR EACH ROW EXECUTE FUNCTION apikey.reject_audit_mutation();
DROP TRIGGER IF EXISTS trigger_api_feature_mutations_immutable ON apikey.feature_mutations;
CREATE TRIGGER trigger_api_feature_mutations_immutable BEFORE UPDATE OR DELETE ON apikey.feature_mutations FOR EACH ROW EXECUTE FUNCTION apikey.reject_audit_mutation();