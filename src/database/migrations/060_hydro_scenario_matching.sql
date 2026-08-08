-- Migration 060: bộ khung hai chế độ KTTV -> kịch bản (Sprint 10a/10b).
-- Forward-only: không sửa 050_kttv_foundation.sql đã có checksum.

CREATE SCHEMA IF NOT EXISTS hydro;

CREATE TABLE IF NOT EXISTS hydro.scenarios (
    id BIGSERIAL PRIMARY KEY,
    code VARCHAR(80) NOT NULL CHECK (code ~ '^[A-Z0-9][A-Z0-9_-]{1,79}$'),
    version INTEGER NOT NULL CHECK (version > 0),
    name VARCHAR(200) NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 200),
    description TEXT,
    match_rule JSONB NOT NULL,
    match_priority INTEGER NOT NULL DEFAULT 100 CHECK (match_priority BETWEEN 1 AND 10000),
    status VARCHAR(20) NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'official', 'archived')),
    is_enabled BOOLEAN NOT NULL DEFAULT false,
    effective_from TIMESTAMPTZ,
    effective_to TIMESTAMPTZ,
    created_by BIGINT NOT NULL REFERENCES auth.users(id),
    published_by BIGINT REFERENCES auth.users(id),
    published_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (code, version),
    CHECK (effective_to IS NULL OR effective_from IS NULL OR effective_to > effective_from),
    CHECK (
        (status = 'draft' AND published_by IS NULL AND published_at IS NULL) OR
        (status IN ('official', 'archived') AND published_by IS NOT NULL AND published_at IS NOT NULL)
    ),
    CHECK (NOT is_enabled OR status = 'official')
);

CREATE INDEX IF NOT EXISTS idx_hydro_scenarios_match
    ON hydro.scenarios (status, is_enabled, match_priority, id)
    WHERE status = 'official' AND is_enabled = true;
CREATE UNIQUE INDEX IF NOT EXISTS uq_hydro_scenarios_one_enabled_code
    ON hydro.scenarios (code) WHERE status = 'official' AND is_enabled = true;

DROP TRIGGER IF EXISTS trigger_hydro_scenarios_updated_at ON hydro.scenarios;
CREATE TRIGGER trigger_hydro_scenarios_updated_at BEFORE UPDATE ON hydro.scenarios
    FOR EACH ROW EXECUTE FUNCTION core.update_updated_at_column();

ALTER TABLE kttv.sources ADD COLUMN IF NOT EXISTS last_attempt_at TIMESTAMPTZ;
ALTER TABLE kttv.sources ADD COLUMN IF NOT EXISTS last_success_at TIMESTAMPTZ;
ALTER TABLE kttv.sources ADD COLUMN IF NOT EXISTS last_error_code VARCHAR(80);
ALTER TABLE kttv.sources ADD COLUMN IF NOT EXISTS last_http_status INTEGER;
ALTER TABLE kttv.sources ADD COLUMN IF NOT EXISTS last_response_bytes BIGINT;

DO $$ BEGIN
    ALTER TABLE kttv.sources
        ADD CONSTRAINT ck_kttv_sources_last_http_status
        CHECK (last_http_status IS NULL OR last_http_status BETWEEN 100 AND 599);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
    ALTER TABLE kttv.sources
        ADD CONSTRAINT ck_kttv_sources_last_response_bytes
        CHECK (last_response_bytes IS NULL OR last_response_bytes >= 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
CREATE INDEX IF NOT EXISTS idx_kttv_sources_collection_status
    ON kttv.sources (is_enabled, last_success_at DESC, id);

CREATE TABLE IF NOT EXISTS kttv.input_batches (
    id BIGSERIAL PRIMARY KEY,
    input_mode VARCHAR(20) NOT NULL CHECK (input_mode IN ('automatic', 'manual')),
    station_code VARCHAR(30) NOT NULL REFERENCES kttv.stations(code),
    observed_at TIMESTAMPTZ NOT NULL,
    values_snapshot JSONB NOT NULL CHECK (jsonb_typeof(values_snapshot) = 'object'),
    raw_payload JSONB NOT NULL CHECK (jsonb_typeof(raw_payload) IN ('object', 'array')),
    source_id BIGINT REFERENCES kttv.sources(id),
    entered_by BIGINT REFERENCES auth.users(id),
    match_status VARCHAR(20) NOT NULL CHECK (match_status IN ('matched', 'no_match', 'ambiguous')),
    scenario_id BIGINT REFERENCES hydro.scenarios(id),
    candidate_scenario_ids BIGINT[] NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (
        (input_mode = 'automatic' AND source_id IS NOT NULL AND entered_by IS NULL) OR
        (input_mode = 'manual' AND source_id IS NULL AND entered_by IS NOT NULL)
    ),
    CHECK (
        (match_status = 'matched' AND scenario_id IS NOT NULL AND cardinality(candidate_scenario_ids) = 1) OR
        (match_status = 'no_match' AND scenario_id IS NULL AND cardinality(candidate_scenario_ids) = 0) OR
        (match_status = 'ambiguous' AND scenario_id IS NULL AND cardinality(candidate_scenario_ids) > 1)
    )
);

CREATE INDEX IF NOT EXISTS idx_kttv_input_batches_created
    ON kttv.input_batches (created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_kttv_input_batches_station_time
    ON kttv.input_batches (station_code, observed_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_kttv_input_batches_automatic
    ON kttv.input_batches (source_id, station_code, observed_at)
    WHERE input_mode = 'automatic';

ALTER TABLE kttv.observations ADD COLUMN IF NOT EXISTS unit VARCHAR(30);
ALTER TABLE kttv.observations ADD COLUMN IF NOT EXISTS input_batch_id BIGINT;
ALTER TABLE kttv.observations ADD COLUMN IF NOT EXISTS input_mode VARCHAR(20);
ALTER TABLE kttv.observations ADD COLUMN IF NOT EXISTS entered_by BIGINT REFERENCES auth.users(id);
ALTER TABLE kttv.observations ADD COLUMN IF NOT EXISTS raw_payload JSONB;

DO $$ BEGIN
    ALTER TABLE kttv.observations
        ADD CONSTRAINT fk_kttv_observations_input_batch
        FOREIGN KEY (input_batch_id) REFERENCES kttv.input_batches(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
    ALTER TABLE kttv.observations
        ADD CONSTRAINT ck_kttv_observations_input_mode
        CHECK (input_mode IS NULL OR input_mode IN ('automatic', 'manual'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
    ALTER TABLE kttv.observations
        ADD CONSTRAINT ck_kttv_observations_unit
        CHECK (unit IS NULL OR char_length(btrim(unit)) BETWEEN 1 AND 30);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
    ALTER TABLE kttv.observations
        ADD CONSTRAINT ck_kttv_observations_provenance
        CHECK (
            input_batch_id IS NULL OR
            (input_mode = 'automatic' AND source_id IS NOT NULL AND entered_by IS NULL) OR
            (input_mode = 'manual' AND source_id IS NULL AND entered_by IS NOT NULL)
        );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_kttv_observations_batch ON kttv.observations (input_batch_id);

ALTER TABLE kttv.observations DROP CONSTRAINT IF EXISTS observations_quality_flag_check;
ALTER TABLE kttv.observations DROP CONSTRAINT IF EXISTS ck_kttv_observations_quality_flag;
ALTER TABLE kttv.observations ALTER COLUMN quality_flag DROP DEFAULT;
ALTER TABLE kttv.observations ALTER COLUMN quality_flag TYPE VARCHAR(20)
    USING CASE quality_flag::text
        WHEN '0' THEN 'valid'
        WHEN '1' THEN 'suspect'
        WHEN '2' THEN 'invalid'
        WHEN '3' THEN 'missing'
        ELSE quality_flag::text
    END;
ALTER TABLE kttv.observations ALTER COLUMN quality_flag SET DEFAULT 'valid';
ALTER TABLE kttv.observations
    ADD CONSTRAINT ck_kttv_observations_quality_flag
    CHECK (quality_flag IN ('valid', 'suspect', 'invalid', 'missing'));

-- TNMT, XD, QT được nhập thủ công và chuẩn bị/khớp. Chỉ TNMT đã có
-- hydro.publish_scenario từ migration nền.
UPDATE auth.roles
SET permissions = jsonb_set(
    jsonb_set(
        jsonb_set(permissions, '{kttv,manual_input}', 'true'::jsonb, true),
        '{kttv,match_scenario}', 'true'::jsonb, true
    ),
    '{kttv,schedule}', 'true'::jsonb, true
)
WHERE code IN ('system_admin', 'so_tnmt', 'so_xd');
