-- Keep initial WebGIS rendering lightweight: only the Cẩm Phả administrative
-- boundary is enabled when the public layer catalog is first loaded.
-- Use the stable layer code instead of an environment-specific numeric ID.

UPDATE gis.layers
SET is_enable_default = (code = 'ranhgioi_campha')
WHERE is_enable_default IS DISTINCT FROM (code = 'ranhgioi_campha');
