-- Restore the legacy on-demand GEE satellite API cache.
-- This is intentionally separate from raster.satellite_images, which stores
-- uploaded catalogue imagery used by /remote-sensing.

CREATE SCHEMA IF NOT EXISTS satellite;

CREATE TABLE IF NOT EXISTS satellite.image_results (
    id              BIGSERIAL PRIMARY KEY,
    request_hash    CHAR(64) NOT NULL UNIQUE,
    image_type      VARCHAR(32) NOT NULL CHECK (image_type IN (
                        'rgb', 'ndvi', 'heatmap', 'classified', 'fire-risk'
                    )),
    collection      VARCHAR(32),
    start_date      DATE NOT NULL,
    end_date        DATE NOT NULL,
    geometry        JSONB,
    tile_url        TEXT NOT NULL,
    map_id          TEXT,
    stats           JSONB NOT NULL DEFAULT '{}'::jsonb,
    legend          JSONB NOT NULL DEFAULT '[]'::jsonb,
    metadata        JSONB NOT NULL DEFAULT '{}'::jsonb,
    status          VARCHAR(32) NOT NULL DEFAULT 'ready' CHECK (status IN (
                        'ready', 'exporting', 'published', 'failed'
                    )),
    gee_task_id     TEXT,
    minio_key       TEXT,
    geoserver_layer TEXT,
    geoserver_store TEXT,
    publish_error   TEXT,
    expires_at      TIMESTAMPTZ NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_satellite_image_results_expires
    ON satellite.image_results (expires_at);
CREATE INDEX IF NOT EXISTS idx_satellite_image_results_status
    ON satellite.image_results (status);

DROP TRIGGER IF EXISTS trigger_satellite_image_results_updated_at ON satellite.image_results;
CREATE TRIGGER trigger_satellite_image_results_updated_at
    BEFORE UPDATE ON satellite.image_results
    FOR EACH ROW EXECUTE FUNCTION core.update_updated_at_column();

-- Legacy publication uses satellite.manage and map_layers.ingest_raster.
UPDATE auth.roles
SET permissions = jsonb_set(
    jsonb_set(
        COALESCE(permissions, '{}'::jsonb),
        '{satellite}',
        '{"read":true,"manage":true}'::jsonb,
        true
    ),
    '{map_layers}',
    COALESCE(permissions->'map_layers', '{}'::jsonb) || '{"ingest_raster":true}'::jsonb,
    true
)
WHERE code IN ('system_admin', 'so_tnmt', 'ubnd_tp');

UPDATE auth.roles
SET permissions = jsonb_set(
    COALESCE(permissions, '{}'::jsonb),
    '{satellite}',
    '{"read":true}'::jsonb,
    true
)
WHERE code IN ('so_xd', 'citizen');
