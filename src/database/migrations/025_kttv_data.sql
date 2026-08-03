-- Migration 025: KTTV (Khí tượng Thủy văn) — trạm đo, thông số và quan trắc Cẩm Phả.

CREATE SCHEMA IF NOT EXISTS kttv;

-- Danh mục trạm đo KTTV
CREATE TABLE IF NOT EXISTS kttv.stations (
    id           BIGSERIAL PRIMARY KEY,
    code         VARCHAR(30) UNIQUE NOT NULL,
    name_vi      VARCHAR(200) NOT NULL,
    station_type VARCHAR(20) NOT NULL
                 CHECK (station_type IN ('meteorological', 'hydrological', 'rainfall', 'tide')),
    status       VARCHAR(10) NOT NULL DEFAULT 'active'
                 CHECK (status IN ('active', 'inactive', 'maintenance')),
    location     GEOGRAPHY(Point, 4326),
    altitude_m   NUMERIC(7,2),
    address      TEXT,
    managing_org VARCHAR(200),
    installed_at DATE,
    metadata     JSONB NOT NULL DEFAULT '{}',
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_kttv_stations_type_status
    ON kttv.stations (station_type, status);
CREATE INDEX IF NOT EXISTS idx_kttv_stations_location
    ON kttv.stations USING GIST (location);

DROP TRIGGER IF EXISTS trigger_kttv_stations_updated_at ON kttv.stations;
CREATE TRIGGER trigger_kttv_stations_updated_at BEFORE UPDATE ON kttv.stations
    FOR EACH ROW EXECUTE FUNCTION core.update_updated_at_column();

-- Thông số đo (biến quan trắc)
CREATE TABLE IF NOT EXISTS kttv.parameters (
    id          SERIAL PRIMARY KEY,
    code        VARCHAR(30) UNIQUE NOT NULL,
    name_vi     VARCHAR(100) NOT NULL,
    unit        VARCHAR(20) NOT NULL,
    description TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO kttv.parameters (code, name_vi, unit, description) VALUES
    ('rainfall',     'Lượng mưa',             'mm',   'Lượng mưa tích lũy trong kỳ quan trắc'),
    ('water_level',  'Mực nước',               'm',    'Mực nước tại trạm so với chuẩn 0 trạm'),
    ('temperature',  'Nhiệt độ không khí',      '°C',   'Nhiệt độ không khí tại độ cao 2m'),
    ('humidity',     'Độ ẩm tương đối',         '%',    'Độ ẩm tương đối của không khí'),
    ('wind_speed',   'Tốc độ gió trung bình',   'm/s',  'Tốc độ gió trung bình 10 phút'),
    ('wind_dir',     'Hướng gió',               '°',    'Hướng gió tính theo độ (0=Bắc)'),
    ('pressure',     'Áp suất khí quyển',       'hPa',  'Áp suất khí quyển quy về mực nước biển'),
    ('flow_rate',    'Lưu lượng dòng chảy',     'm³/s', 'Lưu lượng dòng chảy qua mặt cắt trạm'),
    ('tide_level',   'Mực nước triều',          'm',    'Mực nước triều so với hải đồ')
ON CONFLICT (code) DO UPDATE SET
    name_vi = EXCLUDED.name_vi, unit = EXCLUDED.unit, description = EXCLUDED.description;

-- Liên kết trạm — thông số đo được
CREATE TABLE IF NOT EXISTS kttv.station_parameters (
    station_id   BIGINT NOT NULL REFERENCES kttv.stations(id) ON DELETE CASCADE,
    parameter_id INT    NOT NULL REFERENCES kttv.parameters(id),
    is_primary   BOOLEAN NOT NULL DEFAULT false,
    sensor_model VARCHAR(100),
    calibrated_at DATE,
    PRIMARY KEY (station_id, parameter_id)
);

-- Số liệu quan trắc (time-series)
CREATE TABLE IF NOT EXISTS kttv.observations (
    id           BIGSERIAL,
    station_id   BIGINT NOT NULL REFERENCES kttv.stations(id),
    parameter_id INT    NOT NULL REFERENCES kttv.parameters(id),
    observed_at  TIMESTAMPTZ NOT NULL,
    value        NUMERIC(12,4) NOT NULL,
    quality_flag CHAR(1) NOT NULL DEFAULT 'A'
                 CHECK (quality_flag IN ('A', 'B', 'C', 'D', 'M')),
    source       VARCHAR(20) NOT NULL DEFAULT 'auto'
                 CHECK (source IN ('auto', 'manual', 'forecast')),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (id, observed_at)
) PARTITION BY RANGE (observed_at);

-- Phân vùng theo năm (thêm hàng năm khi cần)
CREATE TABLE IF NOT EXISTS kttv.observations_2025
    PARTITION OF kttv.observations
    FOR VALUES FROM ('2025-01-01') TO ('2026-01-01');
CREATE TABLE IF NOT EXISTS kttv.observations_2026
    PARTITION OF kttv.observations
    FOR VALUES FROM ('2026-01-01') TO ('2027-01-01');
CREATE TABLE IF NOT EXISTS kttv.observations_2027
    PARTITION OF kttv.observations
    FOR VALUES FROM ('2027-01-01') TO ('2028-01-01');

CREATE INDEX IF NOT EXISTS idx_kttv_obs_station_param_time
    ON kttv.observations (station_id, parameter_id, observed_at DESC);
CREATE INDEX IF NOT EXISTS idx_kttv_obs_time
    ON kttv.observations (observed_at DESC);

-- Ngưỡng cảnh báo theo trạm và thông số
CREATE TABLE IF NOT EXISTS kttv.alert_thresholds (
    id           BIGSERIAL PRIMARY KEY,
    station_id   BIGINT NOT NULL REFERENCES kttv.stations(id) ON DELETE CASCADE,
    parameter_id INT    NOT NULL REFERENCES kttv.parameters(id),
    level        VARCHAR(15) NOT NULL CHECK (level IN ('caution', 'warning', 'danger', 'emergency')),
    threshold    NUMERIC(12,4) NOT NULL,
    direction    VARCHAR(4)  NOT NULL DEFAULT 'over' CHECK (direction IN ('over', 'under')),
    is_active    BOOLEAN NOT NULL DEFAULT true,
    set_by       BIGINT REFERENCES auth.users(id),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (station_id, parameter_id, level, direction)
);

DROP TRIGGER IF EXISTS trigger_kttv_thresholds_updated_at ON kttv.alert_thresholds;
CREATE TRIGGER trigger_kttv_thresholds_updated_at BEFORE UPDATE ON kttv.alert_thresholds
    FOR EACH ROW EXECUTE FUNCTION core.update_updated_at_column();
