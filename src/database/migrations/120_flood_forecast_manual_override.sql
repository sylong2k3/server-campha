-- Migration 120: Manual override support for flood forecast schedule slots

ALTER TABLE gis.flood_forecast_schedule
    ADD COLUMN IF NOT EXISTS is_manual_override BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS manual_rainfall NUMERIC(6, 2) NULL,
    ADD COLUMN IF NOT EXISTS manual_updated_at TIMESTAMPTZ NULL;

ALTER TABLE gis.flood_forecast_schedule
    DROP CONSTRAINT IF EXISTS chk_flood_forecast_schedule_status;

ALTER TABLE gis.flood_forecast_schedule
    ADD CONSTRAINT chk_flood_forecast_schedule_status
        CHECK (status IN ('PENDING', 'APPLIED', 'SKIPPED', 'FAILED', 'MANUAL'));

CREATE INDEX IF NOT EXISTS idx_flood_forecast_schedule_override
    ON gis.flood_forecast_schedule (is_manual_override, status);

COMMENT ON COLUMN gis.flood_forecast_schedule.is_manual_override IS 'Đánh dấu khung giờ bị khóa thủ công do người dùng nhập lượng mưa';
COMMENT ON COLUMN gis.flood_forecast_schedule.manual_rainfall IS 'Lượng mưa thủ công do người dùng thiết lập cho khung giờ';
COMMENT ON COLUMN gis.flood_forecast_schedule.manual_updated_at IS 'Thời điểm người dùng thiết lập thủ công';
