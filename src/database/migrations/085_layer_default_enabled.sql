-- Configurable initial visibility for public Web Map layers.
ALTER TABLE gis.layers
    ADD COLUMN IF NOT EXISTS is_enable_default BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN gis.layers.is_enable_default IS
    'Whether the WebGIS client enables this layer when its catalog is first loaded.';
