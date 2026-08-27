-- 113_layer_legend_entries_format.sql
-- Normalize gis.layers.legend_config to the canonical shape used by the
-- admin/client legend UI: either NULL or { "entries": [ { "label", "color" } ] }.
--
-- Older rows (e.g. satellite/raster RGB publishes) stored ad-hoc shapes such
-- as { "type": "rgb", "bands": ["red","green","blue"] } which have no
-- meaningful label/color pairing. These are reset to NULL rather than
-- guessed at, since fabricating labels/colors for raw RGB bands would be
-- incorrect data.

BEGIN;

UPDATE gis.layers
SET legend_config = NULL
WHERE legend_config IS NOT NULL
  AND (
      jsonb_typeof(legend_config) IS DISTINCT FROM 'object'
      OR NOT (legend_config ? 'entries')
      OR jsonb_typeof(legend_config -> 'entries') IS DISTINCT FROM 'array'
      OR jsonb_array_length(legend_config -> 'entries') = 0
  );

-- New layers should default to NULL (no legend) rather than an empty object,
-- matching the API contract (legend is null or {entries:[...]}).
ALTER TABLE gis.layers ALTER COLUMN legend_config DROP DEFAULT;
ALTER TABLE gis.layers ALTER COLUMN legend_config DROP NOT NULL;

COMMIT;
