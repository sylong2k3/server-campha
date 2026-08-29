-- GeoTIFF Time Series: one Web Map layer may contain many satellite granules.
DROP INDEX IF EXISTS raster.uq_satellite_layer;

CREATE UNIQUE INDEX IF NOT EXISTS uq_satellite_layer_time_active
    ON raster.satellite_images (layer_id, acquired_at)
    WHERE layer_id IS NOT NULL AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_satellite_layer_time_active
    ON raster.satellite_images (layer_id, acquired_at, id)
    WHERE layer_id IS NOT NULL AND deleted_at IS NULL;
