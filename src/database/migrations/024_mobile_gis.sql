-- Sprint 9a: isolated mobile drafts for point, line and polygon field sketches.
CREATE TABLE IF NOT EXISTS gis.mobile_drafts (
 id BIGSERIAL PRIMARY KEY, owner_user_id BIGINT NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 org_id INT REFERENCES auth.organizations(id), title VARCHAR(200) NOT NULL CHECK(char_length(btrim(title)) BETWEEN 1 AND 200),
 properties JSONB NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(properties)='object'), geom geometry(Geometry,4326) NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), deleted_at TIMESTAMPTZ,
 CHECK(ST_IsValid(geom) AND NOT ST_IsEmpty(geom)), CHECK(GeometryType(geom) IN('POINT','LINESTRING','POLYGON'))
);
CREATE INDEX IF NOT EXISTS idx_mobile_drafts_geom ON gis.mobile_drafts USING GIST(geom);
CREATE INDEX IF NOT EXISTS idx_mobile_drafts_owner_updated ON gis.mobile_drafts(owner_user_id,updated_at DESC) WHERE deleted_at IS NULL;
DROP TRIGGER IF EXISTS trigger_mobile_drafts_updated_at ON gis.mobile_drafts;
CREATE TRIGGER trigger_mobile_drafts_updated_at BEFORE UPDATE ON gis.mobile_drafts FOR EACH ROW EXECUTE FUNCTION core.update_updated_at_column();