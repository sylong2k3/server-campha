-- Migration 119: Automated 24h weather forecast snapshot and hourly schedule for flood scenarios

CREATE TABLE IF NOT EXISTS gis.flood_forecast_snapshots (
    id BIGSERIAL PRIMARY KEY,
    forecast_date DATE NOT NULL,
    location VARCHAR(100) NOT NULL DEFAULT 'Cam Pha',
    fetched_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    hourly_data JSONB NOT NULL DEFAULT '[]',
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_flood_forecast_snapshots_date_loc UNIQUE (forecast_date, location)
);

CREATE INDEX IF NOT EXISTS idx_flood_forecast_snapshots_date
    ON gis.flood_forecast_snapshots (forecast_date);

CREATE TABLE IF NOT EXISTS gis.flood_forecast_schedule (
    id BIGSERIAL PRIMARY KEY,
    snapshot_id BIGINT REFERENCES gis.flood_forecast_snapshots(id) ON DELETE CASCADE,
    forecast_date DATE NOT NULL,
    hour_str VARCHAR(10) NOT NULL,
    scheduled_time TIMESTAMPTZ NOT NULL,
    chance_of_rain INTEGER NOT NULL DEFAULT 0,
    precip_mm NUMERIC(6, 2) NOT NULL DEFAULT 0.00,
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    applied_scenario_id INTEGER REFERENCES gis.flood_scenarios(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_flood_forecast_schedule_status
        CHECK (status IN ('PENDING', 'APPLIED', 'SKIPPED', 'FAILED')),
    CONSTRAINT uq_forecast_schedule_date_hour
        UNIQUE (forecast_date, hour_str)
);

CREATE INDEX IF NOT EXISTS idx_flood_forecast_schedule_due
    ON gis.flood_forecast_schedule (status, scheduled_time);
CREATE INDEX IF NOT EXISTS idx_flood_forecast_schedule_date
    ON gis.flood_forecast_schedule (forecast_date);

COMMENT ON TABLE gis.flood_forecast_snapshots IS 'Lưu trữ bản chụp dữ liệu dự báo thời tiết 24h thu thập hàng ngày';
COMMENT ON TABLE gis.flood_forecast_schedule IS 'Lịch trình dự báo theo từng giờ trong ngày để tự động kích hoạt kịch bản ngập lụt';
