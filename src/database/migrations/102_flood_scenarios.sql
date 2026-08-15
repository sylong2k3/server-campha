-- Migration 102: Quản lý kịch bản ngập úng (gis.flood_scenarios)

CREATE TABLE IF NOT EXISTS gis.flood_scenarios (
    id SERIAL PRIMARY KEY,
    code VARCHAR(100) NOT NULL UNIQUE,
    name_vi VARCHAR(255) NOT NULL,
    min_rainfall NUMERIC(8, 2) NOT NULL DEFAULT 0.00,
    max_rainfall NUMERIC(8, 2) DEFAULT NULL,
    min_tide NUMERIC(5, 2) DEFAULT NULL,
    max_tide NUMERIC(5, 2) DEFAULT NULL,
    layer_code VARCHAR(120) NOT NULL,
    description TEXT DEFAULT NULL,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_flood_scenarios_rainfall ON gis.flood_scenarios(min_rainfall, max_rainfall);
CREATE INDEX IF NOT EXISTS idx_flood_scenarios_active ON gis.flood_scenarios(is_active);

-- Seed default scenarios linking to published flood layers
INSERT INTO gis.flood_scenarios (
    code,
    name_vi,
    min_rainfall,
    max_rainfall,
    min_tide,
    max_tide,
    layer_code,
    description,
    is_active
)
VALUES
(
    'scenario_light',
    'Kịch bản 1: Ngập nhẹ (Lượng mưa < 50mm)',
    0.00,
    49.99,
    NULL,
    1.99,
    'lop_phu_sau_ngap_2015',
    'Kịch bản ngập nhẹ ứng với đợt mưa nhỏ dưới 50mm và triều thấp',
    true
),
(
    'scenario_moderate',
    'Kịch bản 2: Ngập trung bình (Lượng mưa 50 - 99mm)',
    50.00,
    99.99,
    NULL,
    NULL,
    'lop_phu_sau_ngap_2018',
    'Kịch bản ngập trung bình cho mưa vừa từ 50mm đến 100mm',
    true
),
(
    'scenario_heavy',
    'Kịch bản 3: Ngập cao (Lượng mưa 100 - 199mm)',
    100.00,
    199.99,
    NULL,
    NULL,
    'lop_phu_sau_ngap_2020',
    'Kịch bản ngập diện rộng ứng với đợt mưa lớn 100mm đến 200mm',
    true
),
(
    'scenario_severe',
    'Kịch bản 4: Ngập nghiêm trọng (Lượng mưa 200 - 299mm)',
    200.00,
    299.99,
    NULL,
    NULL,
    'lop_phu_sau_ngap_2022',
    'Kịch bản ngập nghiêm trọng mưa rất lớn trên 200mm',
    true
),
(
    'scenario_extreme',
    'Kịch bản 5: Ngập cực đoan (Lượng mưa >= 300mm hoặc kèm triều cường)',
    300.00,
    NULL,
    2.00,
    NULL,
    'lop_phu_sau_ngap_2024',
    'Kịch bản ngập cực đoan mưa xối xả trên 300mm hoặc triều cường dâng cao',
    true
)
ON CONFLICT (code) DO UPDATE
SET
    name_vi = EXCLUDED.name_vi,
    min_rainfall = EXCLUDED.min_rainfall,
    max_rainfall = EXCLUDED.max_rainfall,
    min_tide = EXCLUDED.min_tide,
    max_tide = EXCLUDED.max_tide,
    layer_code = EXCLUDED.layer_code,
    description = EXCLUDED.description,
    is_active = EXCLUDED.is_active,
    updated_at = CURRENT_TIMESTAMP;
