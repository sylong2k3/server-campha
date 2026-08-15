-- Migration 101: Xóa toàn bộ dữ liệu vận hành flood (runs, artifacts, events, audit, ingest jobs).
-- Giữ nguyên schema và dữ liệu tham chiếu tĩnh (kịch bản script trong gis.layers).
-- Thứ tự truncate giải quyết FK không có ON DELETE CASCADE trên flood_run_audit.

TRUNCATE
    gis.flood_run_audit,
    gis.raster_ingest_dlq,
    gis.flood_run_stage_events,
    gis.flood_artifacts,
    gis.raster_ingest_jobs,
    gis.flood_analysis_runs
RESTART IDENTITY;
