-- Forest Classification runtime restored for the Cẩm Phả platform.
-- The scientific class taxonomy/model remains application-owned and unchanged;
-- this migration adds only persistence, operational publication and RBAC.

CREATE SCHEMA IF NOT EXISTS forest;

CREATE TABLE IF NOT EXISTS forest.forest_snapshots (
    id                      BIGSERIAL PRIMARY KEY,
    year                    INTEGER NOT NULL CHECK (year BETWEEN 1984 AND 2200),
    month                   INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),
    attempt                 INTEGER NOT NULL DEFAULT 1 CHECK (attempt >= 1),
    status                  TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
                                'pending','computing','exporting','completed','published','failed'
                            )),
    trigger                 TEXT NOT NULL DEFAULT 'cron' CHECK (trigger IN ('cron','manual','user')),
    requested_by            BIGINT REFERENCES auth.users(id),
    model_params            JSONB NOT NULL DEFAULT '{}'::jsonb
                                CHECK (jsonb_typeof(model_params) = 'object'),
    province_summary        JSONB CHECK (
                                province_summary IS NULL OR jsonb_typeof(province_summary) = 'object'
                            ),
    district_export_summary JSONB CHECK (
                                district_export_summary IS NULL
                                OR jsonb_typeof(district_export_summary) = 'object'
                            ),
    sample_quotas           JSONB CHECK (
                                sample_quotas IS NULL OR jsonb_typeof(sample_quotas) = 'object'
                            ),
    oob_accuracy            NUMERIC CHECK (oob_accuracy IS NULL OR oob_accuracy BETWEEN 0 AND 100),
    test_accuracy           NUMERIC CHECK (test_accuracy IS NULL OR test_accuracy BETWEEN 0 AND 100),
    test_kappa              NUMERIC CHECK (test_kappa IS NULL OR test_kappa BETWEEN -1 AND 1),
    s2_image_count          INTEGER CHECK (s2_image_count IS NULL OR s2_image_count >= 0),
    ls_image_count          INTEGER CHECK (ls_image_count IS NULL OR ls_image_count >= 0),
    gt_zone_count           INTEGER CHECK (gt_zone_count IS NULL OR gt_zone_count >= 0),
    gt_point_count          INTEGER CHECK (gt_point_count IS NULL OR gt_point_count >= 0),
    gt_window_days          INTEGER CHECK (gt_window_days IS NULL OR gt_window_days > 0),
    gee_task_id             TEXT,
    gee_map_id              TEXT,
    gee_tile_url            TEXT,
    gee_tile_generated_at   TIMESTAMPTZ,
    gee_download_url        TEXT,
    minio_key               TEXT,
    geoserver_layer         TEXT,
    geoserver_store         TEXT,
    download_scale_m        INTEGER NOT NULL DEFAULT 100 CHECK (download_scale_m > 0),
    duration_ms             BIGINT CHECK (duration_ms IS NULL OR duration_ms >= 0),
    retry_count             INTEGER NOT NULL DEFAULT 0 CHECK (retry_count BETWEEN 0 AND 3),
    next_retry_at           TIMESTAMPTZ,
    last_retry_error        TEXT,
    error_message           TEXT,
    computed_at             TIMESTAMPTZ,
    published_at            TIMESTAMPTZ,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (year, month, attempt)
);

CREATE INDEX IF NOT EXISTS idx_forest_snapshots_period
    ON forest.forest_snapshots (year DESC, month DESC, attempt DESC);
CREATE INDEX IF NOT EXISTS idx_forest_snapshots_status
    ON forest.forest_snapshots (status, updated_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_forest_one_live_period
    ON forest.forest_snapshots (year, month)
    WHERE status IN ('pending','computing','exporting');

CREATE TABLE IF NOT EXISTS forest.forest_district_areas (
    id              BIGSERIAL PRIMARY KEY,
    snapshot_id     BIGINT NOT NULL REFERENCES forest.forest_snapshots(id) ON DELETE CASCADE,
    district_code   TEXT,
    district_name   TEXT,
    class_id        SMALLINT NOT NULL CHECK (class_id BETWEEN 0 AND 11),
    class_name      TEXT NOT NULL,
    area_ha         NUMERIC NOT NULL CHECK (area_ha >= 0),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (snapshot_id, district_code, class_id)
);

CREATE INDEX IF NOT EXISTS idx_forest_district_areas_snapshot
    ON forest.forest_district_areas (snapshot_id, district_name, class_id);

CREATE TABLE IF NOT EXISTS forest.forest_district_exports (
    id                      BIGSERIAL PRIMARY KEY,
    snapshot_id             BIGINT NOT NULL REFERENCES forest.forest_snapshots(id) ON DELETE CASCADE,
    district_code           TEXT NOT NULL,
    district_name           TEXT,
    scale_m                 INTEGER NOT NULL DEFAULT 150 CHECK (scale_m > 0),
    status                  TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
                                'pending','computing','completed','published','failed','skipped'
                            )),
    area_by_class           JSONB CHECK (
                                area_by_class IS NULL OR jsonb_typeof(area_by_class) = 'object'
                            ),
    total_area_ha           NUMERIC CHECK (total_area_ha IS NULL OR total_area_ha >= 0),
    forest_area_ha          NUMERIC CHECK (forest_area_ha IS NULL OR forest_area_ha >= 0),
    gee_map_id              TEXT,
    gee_tile_url            TEXT,
    gee_download_url        TEXT,
    gee_download_filename   TEXT,
    gee_generated_at        TIMESTAMPTZ,
    minio_key               TEXT,
    geoserver_layer         TEXT,
    geoserver_store         TEXT,
    raster_ingest_job_id    BIGINT REFERENCES gis.raster_ingest_jobs(id),
    error_message           TEXT,
    duration_ms             BIGINT CHECK (duration_ms IS NULL OR duration_ms >= 0),
    started_at              TIMESTAMPTZ,
    completed_at            TIMESTAMPTZ,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (snapshot_id, district_code)
);

CREATE INDEX IF NOT EXISTS idx_forest_district_exports_snapshot
    ON forest.forest_district_exports (snapshot_id, status, district_code);
CREATE INDEX IF NOT EXISTS idx_forest_district_exports_ingest
    ON forest.forest_district_exports (raster_ingest_job_id)
    WHERE raster_ingest_job_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS forest.forest_gt_zones (
    id              BIGSERIAL PRIMARY KEY,
    name            TEXT,
    observed_at     TIMESTAMPTZ NOT NULL,
    class_id        SMALLINT NOT NULL CHECK (class_id BETWEEN 0 AND 11),
    source          TEXT NOT NULL DEFAULT 'field_survey',
    geom            geometry(MultiPolygon, 4326) NOT NULL,
    area_ha         NUMERIC GENERATED ALWAYS AS (ST_Area(geom::geography) / 10000.0) STORED,
    notes           TEXT,
    created_by      BIGINT REFERENCES auth.users(id),
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_forest_gt_zones_geom
    ON forest.forest_gt_zones USING GIST (geom);
CREATE INDEX IF NOT EXISTS idx_forest_gt_zones_window
    ON forest.forest_gt_zones (observed_at DESC, class_id) WHERE is_active;

CREATE TABLE IF NOT EXISTS forest.forest_gt_points (
    id              BIGSERIAL PRIMARY KEY,
    observed_at     TIMESTAMPTZ NOT NULL,
    class_id        SMALLINT NOT NULL CHECK (class_id BETWEEN 0 AND 11),
    lng             DOUBLE PRECISION NOT NULL CHECK (lng BETWEEN 106 AND 109),
    lat             DOUBLE PRECISION NOT NULL CHECK (lat BETWEEN 20 AND 22.5),
    geom            geometry(Point, 4326) GENERATED ALWAYS AS (
                        ST_SetSRID(ST_MakePoint(lng, lat), 4326)
                    ) STORED,
    source          TEXT NOT NULL DEFAULT 'field_report',
    photo_url       TEXT,
    reporter_name   TEXT,
    notes           TEXT,
    created_by      BIGINT REFERENCES auth.users(id),
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_forest_gt_points_geom
    ON forest.forest_gt_points USING GIST (geom);
CREATE INDEX IF NOT EXISTS idx_forest_gt_points_window
    ON forest.forest_gt_points (observed_at DESC, class_id) WHERE is_active;

DROP TRIGGER IF EXISTS trigger_forest_snapshots_updated_at ON forest.forest_snapshots;
CREATE TRIGGER trigger_forest_snapshots_updated_at
    BEFORE UPDATE ON forest.forest_snapshots
    FOR EACH ROW EXECUTE FUNCTION core.update_updated_at_column();

DROP TRIGGER IF EXISTS trigger_forest_district_exports_updated_at
    ON forest.forest_district_exports;
CREATE TRIGGER trigger_forest_district_exports_updated_at
    BEFORE UPDATE ON forest.forest_district_exports
    FOR EACH ROW EXECUTE FUNCTION core.update_updated_at_column();

DROP TRIGGER IF EXISTS trigger_forest_gt_zones_updated_at ON forest.forest_gt_zones;
CREATE TRIGGER trigger_forest_gt_zones_updated_at
    BEFORE UPDATE ON forest.forest_gt_zones
    FOR EACH ROW EXECUTE FUNCTION core.update_updated_at_column();

DROP TRIGGER IF EXISTS trigger_forest_gt_points_updated_at ON forest.forest_gt_points;
CREATE TRIGGER trigger_forest_gt_points_updated_at
    BEFORE UPDATE ON forest.forest_gt_points
    FOR EACH ROW EXECUTE FUNCTION core.update_updated_at_column();

-- Explicit permissions: no implicit administrator bypass exists in middleware.
UPDATE auth.roles
SET permissions = jsonb_set(
    COALESCE(permissions, '{}'::jsonb),
    '{forest_classification}',
    '{"read":true,"manage":true,"ground_truth":true}'::jsonb,
    true
)
WHERE code IN ('system_admin', 'so_tnmt');

UPDATE auth.roles
SET permissions = jsonb_set(
    COALESCE(permissions, '{}'::jsonb),
    '{forest_classification}',
    '{"read":true}'::jsonb,
    true
)
WHERE code IN ('ubnd_tp', 'so_xd', 'citizen');
