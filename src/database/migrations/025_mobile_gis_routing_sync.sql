-- Sprint 9b: pgRouting graph registry, source-feature version history and offline sync receipts.
CREATE EXTENSION IF NOT EXISTS pgrouting;

CREATE TABLE IF NOT EXISTS gis.routing_networks (
 id BIGSERIAL PRIMARY KEY,
 layer_id BIGINT NOT NULL UNIQUE REFERENCES gis.layers(id) ON DELETE CASCADE,
 directed BOOLEAN NOT NULL DEFAULT false,
 snap_tolerance_m DOUBLE PRECISION NOT NULL DEFAULT 0.5 CHECK(snap_tolerance_m BETWEEN 0.01 AND 20),
 topology_version BIGINT NOT NULL DEFAULT 0 CHECK(topology_version>=0),
 status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK(status IN('pending','building','ready','invalid','failed')),
 evidence JSONB NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(evidence)='object'),
 built_at TIMESTAMPTZ,
 created_by BIGINT NOT NULL REFERENCES auth.users(id), updated_by BIGINT NOT NULL REFERENCES auth.users(id),
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_routing_networks_status ON gis.routing_networks(status,updated_at DESC);
DROP TRIGGER IF EXISTS trigger_routing_networks_updated_at ON gis.routing_networks;
CREATE TRIGGER trigger_routing_networks_updated_at BEFORE UPDATE ON gis.routing_networks FOR EACH ROW EXECUTE FUNCTION core.update_updated_at_column();

CREATE TABLE IF NOT EXISTS gis.routing_vertices (
 network_id BIGINT NOT NULL REFERENCES gis.routing_networks(id) ON DELETE CASCADE,
 id BIGINT NOT NULL, geom geometry(Point,4326) NOT NULL,
 PRIMARY KEY(network_id,id)
);
CREATE INDEX IF NOT EXISTS idx_routing_vertices_geom ON gis.routing_vertices USING GIST(geom);

CREATE TABLE IF NOT EXISTS gis.routing_edges (
 id BIGSERIAL PRIMARY KEY, network_id BIGINT NOT NULL REFERENCES gis.routing_networks(id) ON DELETE CASCADE,
 source_feature_id VARCHAR(120) NOT NULL, segment_index INT NOT NULL CHECK(segment_index>0),
 source BIGINT NOT NULL, target BIGINT NOT NULL,
 cost DOUBLE PRECISION NOT NULL CHECK(cost>0), reverse_cost DOUBLE PRECISION NOT NULL,
 geom geometry(LineString,4326) NOT NULL CHECK(ST_IsValid(geom) AND NOT ST_IsEmpty(geom)),
 UNIQUE(network_id,source_feature_id,segment_index),
 FOREIGN KEY(network_id,source) REFERENCES gis.routing_vertices(network_id,id) ON DELETE CASCADE,
 FOREIGN KEY(network_id,target) REFERENCES gis.routing_vertices(network_id,id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_routing_edges_network_source ON gis.routing_edges(network_id,source);
CREATE INDEX IF NOT EXISTS idx_routing_edges_network_target ON gis.routing_edges(network_id,target);
CREATE INDEX IF NOT EXISTS idx_routing_edges_geom ON gis.routing_edges USING GIST(geom);

CREATE TABLE IF NOT EXISTS gis.feature_states (
 layer_id BIGINT NOT NULL REFERENCES gis.layers(id) ON DELETE CASCADE,
 feature_id VARCHAR(120) NOT NULL, version BIGINT NOT NULL DEFAULT 1 CHECK(version>=1),
 updated_by BIGINT REFERENCES auth.users(id), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 PRIMARY KEY(layer_id,feature_id)
);

CREATE TABLE IF NOT EXISTS gis.feature_versions (
 id BIGSERIAL PRIMARY KEY, layer_id BIGINT NOT NULL REFERENCES gis.layers(id) ON DELETE CASCADE,
 feature_id VARCHAR(120) NOT NULL, version BIGINT NOT NULL CHECK(version>=1),
 action VARCHAR(20) NOT NULL CHECK(action IN('baseline','update','restore')),
 before_attributes JSONB NOT NULL CHECK(jsonb_typeof(before_attributes)='object'),
 after_attributes JSONB NOT NULL CHECK(jsonb_typeof(after_attributes)='object'),
 before_geom geometry(Geometry,4326) NOT NULL, after_geom geometry(Geometry,4326) NOT NULL,
 restored_from_version BIGINT CHECK(restored_from_version IS NULL OR restored_from_version>=1),
 changed_by BIGINT NOT NULL REFERENCES auth.users(id), client_id UUID, client_change_id UUID,
 changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE(layer_id,feature_id,version)
);
CREATE INDEX IF NOT EXISTS idx_feature_versions_history ON gis.feature_versions(layer_id,feature_id,version DESC);
CREATE OR REPLACE FUNCTION gis.reject_feature_version_update() RETURNS TRIGGER AS $$ BEGIN RAISE EXCEPTION 'Feature version history is immutable'; END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trigger_feature_versions_immutable ON gis.feature_versions;
CREATE TRIGGER trigger_feature_versions_immutable BEFORE UPDATE ON gis.feature_versions FOR EACH ROW EXECUTE FUNCTION gis.reject_feature_version_update();

CREATE TABLE IF NOT EXISTS gis.mobile_sync_receipts (
 id BIGSERIAL PRIMARY KEY, actor_user_id BIGINT NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 client_id UUID NOT NULL, client_change_id UUID NOT NULL,
 status VARCHAR(20) NOT NULL CHECK(status IN('applied','conflict')),
 result JSONB NOT NULL CHECK(jsonb_typeof(result)='object'), created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 UNIQUE(actor_user_id,client_id,client_change_id)
);
CREATE INDEX IF NOT EXISTS idx_mobile_sync_receipts_created ON gis.mobile_sync_receipts(actor_user_id,created_at DESC);

ALTER TABLE auth.activity_logs DROP CONSTRAINT IF EXISTS activity_logs_action_check;
ALTER TABLE auth.activity_logs ADD CONSTRAINT activity_logs_action_check CHECK(action IN(
 'register','login','login_failed','logout','refresh_token','change_password','social_login','social_link','social_unlink',
 'account_locked','account_unlocked','force_logout','password_reset_request','password_reset','password_reset_failed',
 'email_verification_sent','email_verified','token_reuse_detected','user_create','user_role_change','user_active_change',
 'user_delete','admin_password_reset','system_logs_cleanup','map_feature_update','map_feature_restore','mobile_sync'
));