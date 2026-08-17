-- Migration 107: Add input observation fields to flood_scenarios
-- Adds current rainfall/tide values and their data source metadata.
-- Source 'MANUAL' = admin-entered. 'AUTO' = future station integration.

ALTER TABLE gis.flood_scenarios
    ADD COLUMN IF NOT EXISTS current_rainfall NUMERIC(6, 2)  NULL,
    ADD COLUMN IF NOT EXISTS rainfall_source  VARCHAR(10)    NOT NULL DEFAULT 'MANUAL',
    ADD COLUMN IF NOT EXISTS current_tide     NUMERIC(4, 2)  NULL,
    ADD COLUMN IF NOT EXISTS tide_source      VARCHAR(10)    NOT NULL DEFAULT 'MANUAL';

ALTER TABLE gis.flood_scenarios
    ADD CONSTRAINT chk_flood_scenarios_rainfall_source
        CHECK (rainfall_source IN ('MANUAL', 'AUTO')),
    ADD CONSTRAINT chk_flood_scenarios_tide_source
        CHECK (tide_source IN ('MANUAL', 'AUTO'));

COMMENT ON COLUMN gis.flood_scenarios.current_rainfall IS 'Current observed rainfall in mm. NULL = no data.';
COMMENT ON COLUMN gis.flood_scenarios.rainfall_source  IS 'MANUAL = admin-entered, AUTO = fetched from station.';
COMMENT ON COLUMN gis.flood_scenarios.current_tide     IS 'Current observed tide level in metres. NULL = no data.';
COMMENT ON COLUMN gis.flood_scenarios.tide_source      IS 'MANUAL = admin-entered, AUTO = fetched from station.';
