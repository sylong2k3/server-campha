-- Publish satellite GeoTIFFs as Web Map layers.
ALTER TABLE raster.satellite_images
    ADD COLUMN IF NOT EXISTS layer_id BIGINT REFERENCES gis.layers(id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_satellite_layer
    ON raster.satellite_images (layer_id) WHERE layer_id IS NOT NULL;