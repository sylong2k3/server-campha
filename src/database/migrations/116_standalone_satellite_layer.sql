-- Standalone per-image layer, independent of Time Series collection layer_id.
ALTER TABLE raster.satellite_images
    ADD COLUMN IF NOT EXISTS standalone_layer_id BIGINT REFERENCES gis.layers(id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_satellite_standalone_layer
    ON raster.satellite_images (standalone_layer_id)
    WHERE standalone_layer_id IS NOT NULL AND deleted_at IS NULL;
