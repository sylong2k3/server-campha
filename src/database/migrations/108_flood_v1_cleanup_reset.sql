-- Migration 108: Xóa toàn bộ dữ liệu Flood TREND_V1 và reset về trạng thái sạch.
-- Chỉ giữ lại pipeline TREND_FINAL.
-- Sau migration này, mọi run mới đều là TREND_FINAL.

-- Bước 1: Xóa layers GeoServer liên quan đến flood TREND_V1 runs.
-- (Các layer TREND_V1 có artifact code bắt đầu bằng fl_trend_ nhưng không thuộc TREND_FINAL)
DELETE FROM gis.layers
WHERE code LIKE 'fl_trend_%'
  AND code NOT LIKE 'fl_trend_flood_extent_%'
  AND code NOT LIKE 'fl_trend_flood_frequency_%'
  AND code NOT LIKE 'fl_trend_frequent_flood_%'
  AND code NOT LIKE 'fl_trend_new_flood_%'
  AND code NOT LIKE 'fl_trend_pop_affected_%'
  AND code NOT LIKE 'fl_trend_crop_affected_%'
  AND code NOT LIKE 'fl_trend_built_affected_%'
  AND code NOT LIKE 'fl_trend_pond_to_built_%'
  AND code NOT LIKE 'fl_trend_drainage_sensitive_%'
  AND code NOT LIKE 'fl_trend_encroachment_alert_%'
  AND code NOT LIKE 'fl_trend_stratum_%';

-- Bước 2: Reset toàn bộ dữ liệu vận hành flood.
-- (Bao gồm cả TREND_V1 lẫn các TREND_FINAL runs cũ trong quá trình phát triển)
TRUNCATE
    gis.flood_run_audit,
    gis.raster_ingest_dlq,
    gis.flood_run_stage_events,
    gis.flood_artifacts,
    gis.raster_ingest_jobs,
    gis.flood_analysis_runs
RESTART IDENTITY;

-- Bước 3: Xóa layers flood (TREND_FINAL layers từ các run cũ sẽ được tạo lại khi chạy mới).
DELETE FROM gis.layers WHERE code LIKE 'fl_%';

-- Kết quả: DB sạch, sẵn sàng cho TREND_FINAL runs mới.
