-- Migration 099: Add 'forecast' module to flood_analysis_runs and flood_artifacts check constraints

ALTER TABLE gis.flood_analysis_runs
  DROP CONSTRAINT flood_analysis_runs_module_check,
  ADD CONSTRAINT flood_analysis_runs_module_check
    CHECK (module = ANY (ARRAY['event'::text, 'hand'::text, 'rain'::text, 'impact'::text, 'trend'::text, 'forecast'::text]));

ALTER TABLE gis.flood_artifacts
  DROP CONSTRAINT flood_artifacts_module_check,
  ADD CONSTRAINT flood_artifacts_module_check
    CHECK (module = ANY (ARRAY['event'::text, 'hand'::text, 'rain'::text, 'impact'::text, 'trend'::text, 'forecast'::text]));
