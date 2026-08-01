-- Sprint 8: community field reports, device push tokens and PostgreSQL realtime events.
CREATE SCHEMA IF NOT EXISTS community;
CREATE TABLE IF NOT EXISTS community.field_reports (
 id BIGSERIAL PRIMARY KEY, reference_code VARCHAR(32) UNIQUE,
 sender_user_id BIGINT NOT NULL REFERENCES auth.users(id), org_id INT REFERENCES auth.organizations(id),
 description VARCHAR(2000) NOT NULL CHECK(char_length(btrim(description)) BETWEEN 10 AND 2000),
 location geometry(Point,4326) NOT NULL, measured_geometry geometry(Geometry,4326),
 status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK(status IN('pending','under_review','approved','rejected','resolved')),
 review_reason VARCHAR(1000), reviewed_by BIGINT REFERENCES auth.users(id), reviewed_at TIMESTAMPTZ,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), deleted_at TIMESTAMPTZ,
 CHECK(ST_IsValid(location) AND NOT ST_IsEmpty(location)),
 CHECK(measured_geometry IS NULL OR(ST_IsValid(measured_geometry) AND NOT ST_IsEmpty(measured_geometry) AND GeometryType(measured_geometry) IN('POINT','LINESTRING','POLYGON'))),
 CHECK((status IN('pending','under_review')) OR reviewed_by IS NOT NULL),
 CHECK(status<>'rejected' OR char_length(btrim(review_reason)) BETWEEN 5 AND 1000)
);
CREATE INDEX IF NOT EXISTS idx_field_reports_location ON community.field_reports USING GIST(location);
CREATE INDEX IF NOT EXISTS idx_field_reports_status_created ON community.field_reports(status,created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_field_reports_sender_created ON community.field_reports(sender_user_id,created_at DESC) WHERE deleted_at IS NULL;
CREATE TABLE IF NOT EXISTS community.field_report_photos(
 report_id BIGINT NOT NULL REFERENCES community.field_reports(id) ON DELETE CASCADE,
 file_object_id BIGINT NOT NULL REFERENCES core.file_objects(id), sort_order SMALLINT NOT NULL CHECK(sort_order BETWEEN 1 AND 5),
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), PRIMARY KEY(report_id,file_object_id), UNIQUE(report_id,sort_order)
);
CREATE TABLE IF NOT EXISTS community.field_report_status_history(
 id BIGSERIAL PRIMARY KEY, report_id BIGINT NOT NULL REFERENCES community.field_reports(id) ON DELETE CASCADE,
 previous_status VARCHAR(20), new_status VARCHAR(20) NOT NULL, reason VARCHAR(1000),
 actor_user_id BIGINT NOT NULL REFERENCES auth.users(id), created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_field_report_history ON community.field_report_status_history(report_id,created_at,id);
CREATE TABLE IF NOT EXISTS auth.device_tokens(
 id BIGSERIAL PRIMARY KEY, user_id BIGINT NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 token_hash CHAR(64) NOT NULL UNIQUE, token_ciphertext TEXT NOT NULL, token_iv CHAR(24) NOT NULL, token_auth_tag CHAR(32) NOT NULL,
 platform VARCHAR(20) NOT NULL CHECK(platform IN('android','ios','web')), last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 disabled_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_device_tokens_user_active ON auth.device_tokens(user_id) WHERE disabled_at IS NULL;
CREATE OR REPLACE FUNCTION community.validate_field_report_transition() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN IF NEW.status=OLD.status THEN RETURN NEW; END IF;
 IF NOT((OLD.status='pending' AND NEW.status IN('under_review','approved','rejected')) OR(OLD.status='under_review' AND NEW.status IN('approved','rejected')) OR(OLD.status='approved' AND NEW.status='resolved')) THEN
  RAISE EXCEPTION 'Invalid field report transition: % -> %',OLD.status,NEW.status USING ERRCODE='23514'; END IF; RETURN NEW; END $$;
DROP TRIGGER IF EXISTS trigger_field_report_transition ON community.field_reports;
CREATE TRIGGER trigger_field_report_transition BEFORE UPDATE OF status ON community.field_reports FOR EACH ROW EXECUTE FUNCTION community.validate_field_report_transition();
CREATE OR REPLACE FUNCTION community.notify_field_report_event() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE event_name TEXT; BEGIN event_name:=CASE WHEN TG_OP='INSERT' THEN 'created' ELSE 'status_changed' END;
 IF TG_OP='UPDATE' AND NEW.status=OLD.status THEN RETURN NEW; END IF;
 PERFORM pg_notify('field_report_events',json_build_object('reportId',NEW.id,'event',event_name,'status',NEW.status)::text); RETURN NEW; END $$;
DROP TRIGGER IF EXISTS trigger_field_report_notify_insert ON community.field_reports;
CREATE TRIGGER trigger_field_report_notify_insert AFTER INSERT ON community.field_reports FOR EACH ROW EXECUTE FUNCTION community.notify_field_report_event();
DROP TRIGGER IF EXISTS trigger_field_report_notify_status ON community.field_reports;
CREATE TRIGGER trigger_field_report_notify_status AFTER UPDATE OF status ON community.field_reports FOR EACH ROW EXECUTE FUNCTION community.notify_field_report_event();
DROP TRIGGER IF EXISTS trigger_field_reports_updated_at ON community.field_reports;
CREATE TRIGGER trigger_field_reports_updated_at BEFORE UPDATE ON community.field_reports FOR EACH ROW EXECUTE FUNCTION core.update_updated_at_column();
DROP TRIGGER IF EXISTS trigger_device_tokens_updated_at ON auth.device_tokens;
CREATE TRIGGER trigger_device_tokens_updated_at BEFORE UPDATE ON auth.device_tokens FOR EACH ROW EXECUTE FUNCTION core.update_updated_at_column();
UPDATE auth.roles SET permissions=jsonb_set(permissions,'{field_report}',CASE code
 WHEN 'system_admin' THEN '{"notify":true,"read":true,"stats":true}'::jsonb
 WHEN 'citizen' THEN '{"create":true,"measure":true}'::jsonb
 ELSE '{"notify":true,"read":true,"stats":true,"approve":true,"create":true,"measure":true}'::jsonb END,true),updated_at=NOW()
WHERE code IN('system_admin','ubnd_tp','so_tnmt','so_xd','citizen');