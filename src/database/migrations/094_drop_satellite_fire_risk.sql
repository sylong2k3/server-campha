-- Drop the `fire-risk` value from satellite.image_results.image_type.
--
-- Fire-risk was inherited from the reference project and has never been part
-- of the Cẩm Phả scope. The runtime code (satellite service + controller +
-- routes) no longer emits or accepts `fire-risk`; the CHECK constraint from
-- migration 087 is the only remaining tie.
--
-- Any orphan rows are archived as `classified` so we don't fail the ALTER on
-- an existing row that violates the new constraint.

UPDATE satellite.image_results
SET image_type = 'classified'
WHERE image_type = 'fire-risk';

ALTER TABLE satellite.image_results
    DROP CONSTRAINT IF EXISTS image_results_image_type_check;

ALTER TABLE satellite.image_results
    ADD CONSTRAINT image_results_image_type_check
    CHECK (image_type IN ('rgb', 'ndvi', 'heatmap', 'classified'));
