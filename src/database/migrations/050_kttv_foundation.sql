-- Migration 050: KTTV (Khí tượng Thủy văn) — Công việc 7.7 (Sprint 10a: khai báo nguồn +
-- danh mục trạm). Thu thập tự động, kiểm soát chất lượng và cảnh báo là Sprint 10b (worker).
-- Schema theo đúng đặc tả docs/KE_HOACH_XAY_DUNG_HE_THONG.md mục "C.2 kttv.* — Công việc 7.7".

CREATE SCHEMA IF NOT EXISTS kttv;

-- Nguồn dữ liệu KTTV (NCHMF, JAXA GSMaP, NASA GPM, ECMWF ERA5, ...).
CREATE TABLE IF NOT EXISTS kttv.sources (
    id BIGSERIAL PRIMARY KEY,
    name VARCHAR(200) NOT NULL,
    provider VARCHAR(200),
    service_type VARCHAR(20) NOT NULL
        CHECK (service_type IN ('REST', 'WMS', 'WMTS', 'WFS', 'WCS', 'GEE', 'FTP')),
    endpoint_url TEXT NOT NULL,
    auth_method VARCHAR(20),
    credential_enc BYTEA,                      -- mã hóa bằng pgcrypto, không bao giờ trả về API
    rate_limit_per_min INT,
    rate_limit_per_day INT,
    response_format VARCHAR(20)
        CHECK (response_format IS NULL OR response_format IN ('JSON', 'GeoJSON', 'GeoTIFF', 'NetCDF', 'GRIB2', 'PNG')),
    license_note TEXT,
    spatial_config JSONB NOT NULL DEFAULT '{}',    -- bbox, clip layer, srid nguồn/đích, nội suy
    temporal_config JSONB NOT NULL DEFAULT '{}',   -- chu kỳ, múi giờ, độ trễ, hạn lưu trữ
    variables JSONB NOT NULL DEFAULT '{}',         -- biến, đơn vị gốc, hệ số quy đổi, NoData, min/max
    display_config JSONB NOT NULL DEFAULT '{}',    -- thang màu, ngưỡng, độ trong suốt, z-index
    cron_expr VARCHAR(50),
    retry_count INT NOT NULL DEFAULT 3,
    retry_delay_sec INT NOT NULL DEFAULT 60,
    fallback_source_id BIGINT REFERENCES kttv.sources(id),
    is_enabled BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS trigger_kttv_sources_updated_at ON kttv.sources;
CREATE TRIGGER trigger_kttv_sources_updated_at BEFORE UPDATE ON kttv.sources
    FOR EACH ROW EXECUTE FUNCTION core.update_updated_at_column();

-- Danh mục trạm quan trắc (PK = code, theo đặc tả).
CREATE TABLE IF NOT EXISTS kttv.stations (
    code VARCHAR(30) PRIMARY KEY,
    name VARCHAR(200) NOT NULL,
    station_type VARCHAR(30)
        CHECK (station_type IS NULL OR station_type IN ('mua', 'thuy_van', 'hai_van', 'khi_tuong_be_mat')),
    geom GEOMETRY(Point, 4326) NOT NULL,
    elevation_m NUMERIC(8,2),
    managing_org VARCHAR(200),
    thiessen_weight NUMERIC(6,4),
    alarm_level_1_m NUMERIC(8,3),               -- cấp báo động I
    alarm_level_2_m NUMERIC(8,3),               -- cấp báo động II
    alarm_level_3_m NUMERIC(8,3),               -- cấp báo động III
    is_used_for_basin BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_kttv_stations_geom ON kttv.stations USING GIST (geom);

DROP TRIGGER IF EXISTS trigger_kttv_stations_updated_at ON kttv.stations;
CREATE TRIGGER trigger_kttv_stations_updated_at BEFORE UPDATE ON kttv.stations
    FOR EACH ROW EXECUTE FUNCTION core.update_updated_at_column();

-- Chuỗi số liệu trạm quan trắc: phân mảnh theo THÁNG (docs C.3 — bảng lớn dùng partition + BRIN).
CREATE TABLE IF NOT EXISTS kttv.observations (
    station_code VARCHAR(30) NOT NULL REFERENCES kttv.stations(code),
    variable VARCHAR(30) NOT NULL,
    observed_at TIMESTAMPTZ NOT NULL,
    value NUMERIC(14,4),
    quality_flag SMALLINT NOT NULL DEFAULT 0    -- 0 ok, 1 ngoài khoảng, 2 nhảy bậc, 3 mất tín hiệu
        CHECK (quality_flag BETWEEN 0 AND 3),
    source_id BIGINT REFERENCES kttv.sources(id)
) PARTITION BY RANGE (observed_at);

-- Partition khởi tạo cho 3 tháng hiện tại; Sprint 10b sẽ tự động hoá việc tạo partition
-- tháng mới qua worker/cron (không thuộc phạm vi migration schema này).
CREATE TABLE IF NOT EXISTS kttv.observations_2026_08 PARTITION OF kttv.observations
    FOR VALUES FROM ('2026-08-01') TO ('2026-09-01');
CREATE TABLE IF NOT EXISTS kttv.observations_2026_09 PARTITION OF kttv.observations
    FOR VALUES FROM ('2026-09-01') TO ('2026-10-01');
CREATE TABLE IF NOT EXISTS kttv.observations_2026_10 PARTITION OF kttv.observations
    FOR VALUES FROM ('2026-10-01') TO ('2026-11-01');

CREATE INDEX IF NOT EXISTS idx_kttv_observations_station_var_time
    ON kttv.observations (station_code, variable, observed_at DESC);
CREATE INDEX IF NOT EXISTS idx_kttv_observations_time_brin
    ON kttv.observations USING BRIN (observed_at);

-- Dữ liệu KTTV dạng lưới/raster (GSMaP, GPM, ERA5, NetCDF, GeoTIFF).
CREATE TABLE IF NOT EXISTS kttv.grid_assets (
    id BIGSERIAL PRIMARY KEY,
    source_id BIGINT NOT NULL REFERENCES kttv.sources(id),
    variable VARCHAR(50) NOT NULL,
    valid_at TIMESTAMPTZ NOT NULL,
    bbox GEOMETRY(Polygon, 4326),
    resolution_deg NUMERIC(8,5),
    object_key TEXT NOT NULL,
    checksum VARCHAR(64),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_kttv_grid_valid_at ON kttv.grid_assets (valid_at);
CREATE INDEX IF NOT EXISTS idx_kttv_grid_bbox ON kttv.grid_assets USING GIST (bbox);
