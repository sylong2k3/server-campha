-- Migration 114: Normalize reviewed Cam Pha RBAC matrix.
-- Forward-only and idempotent. Source: server/docs/MA_TRAN_PHAN_QUYEN.csv.
-- Reviewed: UB may run forecast and raster classification; explicit read keys;
-- flood.configure removed because no endpoint currently authorizes it.

UPDATE auth.roles
SET permissions = COALESCE(permissions, '{}'::jsonb) #- '{flood,configure}', updated_at = NOW()
WHERE code IN ('system_admin', 'ubnd_tp', 'so_tnmt', 'so_xd', 'citizen');

UPDATE auth.roles
SET permissions = jsonb_set(
        jsonb_set(COALESCE(permissions, '{}'::jsonb), '{flood_forecast,run}', 'true'::jsonb, true),
        '{raster,classify}', 'true'::jsonb, true),
    updated_at = NOW()
WHERE code = 'ubnd_tp';

UPDATE auth.roles
SET permissions =
        jsonb_set(jsonb_set(jsonb_set(jsonb_set(jsonb_set(
            COALESCE(permissions, '{}'::jsonb),
            '{system_logs,read}', 'true'::jsonb, true),
            '{system_logs,manage}', 'true'::jsonb, true),
            '{notifications,send}', CASE WHEN code IN ('system_admin', 'so_tnmt') THEN 'true'::jsonb ELSE 'false'::jsonb END, true),
            '{satellite,manage}', CASE WHEN code IN ('system_admin', 'ubnd_tp', 'so_tnmt') THEN 'true'::jsonb ELSE 'false'::jsonb END, true),
            '{map_layers,ingest_raster}', CASE WHEN code IN ('system_admin', 'ubnd_tp', 'so_tnmt') THEN 'true'::jsonb ELSE 'false'::jsonb END, true),
    updated_at = NOW()
WHERE code IN ('system_admin', 'ubnd_tp', 'so_tnmt', 'so_xd', 'citizen');

UPDATE auth.roles
SET permissions = jsonb_set(
        jsonb_set(COALESCE(permissions, '{}'::jsonb), '{spatial,read}', 'true'::jsonb, true),
            '{map_feature,read}', CASE WHEN code IN ('system_admin', 'so_tnmt') THEN 'true'::jsonb ELSE 'false'::jsonb END, true),
    updated_at = NOW()
WHERE code IN ('system_admin', 'ubnd_tp', 'so_tnmt', 'so_xd', 'citizen');
