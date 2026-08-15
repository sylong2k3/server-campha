-- Migration 102: Create gis.flood_scenarios table for Flood Scenario Management

CREATE TABLE IF NOT EXISTS gis.flood_scenarios (
    id SERIAL PRIMARY KEY,
    code VARCHAR(100) NOT NULL UNIQUE,
    name_vi VARCHAR(255) NOT NULL,
    min_rainfall NUMERIC(6, 2) NOT NULL DEFAULT 0.0,
    max_rainfall NUMERIC(6, 2),
    min_tide NUMERIC(4, 2),
    max_tide NUMERIC(4, 2),
    layer_code VARCHAR(120) NOT NULL,
    description TEXT,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_flood_scenarios_rainfall ON gis.flood_scenarios (min_rainfall, max_rainfall);
CREATE INDEX IF NOT EXISTS idx_flood_scenarios_active ON gis.flood_scenarios (is_active);

-- Seed initial default scenarios mapping to post-flood cover layers (lop_phu_sau_ngap_*)
INSERT INTO gis.flood_scenarios (code, name_vi, min_rainfall, max_rainfall, min_tide, max_tide, layer_code, description, is_active)
VALUES
    ('scenario_light', 'Kịch bản ngập nhẹ (Mưa < 50mm)', 0.0, 49.99, NULL, 1.99, 'lop_phu_sau_ngap_2015', 'Kịch bản mưa nhỏ và triều thấp', true),
    ('scenario_moderate', 'Kịch bản ngập vừa (Mưa 50 - 99mm)', 50.0, 99.99, NULL, 1.99, 'lop_phu_sau_ngap_2018', 'Kịch bản mưa trung bình', true),
    ('scenario_heavy', 'Kịch bản ngập nặng (Mưa 100 - 199mm)', 100.0, 199.99, NULL, 1.99, 'lop_phu_sau_ngap_2020', 'Kịch bản mưa lớn', true),
    ('scenario_severe', 'Kịch bản ngập rất nặng (Mưa 200 - 299mm)', 200.0, 299.99, NULL, 1.99, 'lop_phu_sau_ngap_2022', 'Kịch bản mưa rất lớn', true),
    ('scenario_extreme', 'Kịch bản ngập cực đoan (Mưa >= 300mm hoặc triều cường)', 300.0, NULL, 2.00, NULL, 'lop_phu_sau_ngap_2024', 'Kịch bản mưa cực đoan hoặc triều dâng cao', true)
ON CONFLICT (code) DO NOTHING;
