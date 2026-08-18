-- Migration 110: Xóa toàn bộ lịch sử vận hành flood — reset về trạng thái sạch.
--
-- Bối cảnh:
--   DB chứa các run thử nghiệm từ quá trình phát triển model TREND_MONITORING_V1.
--   Migration này xóa sạch toàn bộ để production bắt đầu với trạng thái clean,
--   palette và legend đã được căn chỉnh chính xác theo new_code.js (GEE script).
--
-- Phạm vi:
--   - TRUNCATE toàn bộ bảng vận hành flood + ingest jobs (giữ cấu trúc bảng)
--   - Xóa gis.layers entries thuộc flood (code LIKE 'fl_%')
--   - Không ảnh hưởng cấu trúc bảng, config, seed data, legend overrides file
--
-- Legend overrides:
--   Đi kèm migration này là cập nhật flood-legends-overrides.json theo palette
--   và nhãn từ new_code.js §9 (Map.addLayer / legend UI).
--   File: server/src/data/flood-legends-overrides.json
--
-- Rollback:
--   Không có rollback tự động — dữ liệu bị xóa vĩnh viễn.
--   Cần backup DB trước khi chạy nếu muốn phục hồi.

-- ── DRY-RUN PREVIEW (chạy riêng trước khi thực thi) ──────────────────────────
-- SELECT COUNT(*) AS runs      FROM gis.flood_analysis_runs;
-- SELECT COUNT(*) AS artifacts FROM gis.flood_artifacts;
-- SELECT COUNT(*) AS stages    FROM gis.flood_run_stage_events;
-- SELECT COUNT(*) AS audits    FROM gis.flood_run_audit;
-- SELECT COUNT(*) AS jobs      FROM gis.raster_ingest_jobs;
-- SELECT COUNT(*) AS dlq       FROM gis.raster_ingest_dlq;
-- SELECT COUNT(*) AS layers    FROM gis.layers WHERE code LIKE 'fl_%';
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- ── Bước 1: Xóa flood layers khỏi gis.layers ─────────────────────────────────
-- Thực hiện trước TRUNCATE: gis.layers không có FK ngược vào bảng flood nên
-- phải xóa tay. Pattern 'fl_%' khớp với toàn bộ artifact layers flood.
DELETE FROM gis.layers WHERE code LIKE 'fl_%';

-- ── Bước 2: Reset toàn bộ dữ liệu vận hành flood ─────────────────────────────
-- TRUNCATE CASCADE để PostgreSQL tự xử lý FK phụ thuộc nội bộ.
-- RESTART IDENTITY: reset serial counter về 1 cho tất cả các bảng.
TRUNCATE
    gis.flood_run_audit,
    gis.raster_ingest_dlq,
    gis.flood_run_stage_events,
    gis.flood_artifacts,
    gis.raster_ingest_jobs,
    gis.flood_analysis_runs
RESTART IDENTITY;

-- ── Xác nhận kết quả ─────────────────────────────────────────────────────────
DO $$
DECLARE
    v_runs    int;
    v_arts    int;
    v_stages  int;
    v_audits  int;
    v_jobs    int;
    v_dlq     int;
    v_layers  int;
BEGIN
    SELECT COUNT(*) INTO v_runs   FROM gis.flood_analysis_runs;
    SELECT COUNT(*) INTO v_arts   FROM gis.flood_artifacts;
    SELECT COUNT(*) INTO v_stages FROM gis.flood_run_stage_events;
    SELECT COUNT(*) INTO v_audits FROM gis.flood_run_audit;
    SELECT COUNT(*) INTO v_jobs   FROM gis.raster_ingest_jobs;
    SELECT COUNT(*) INTO v_dlq    FROM gis.raster_ingest_dlq;
    SELECT COUNT(*) INTO v_layers FROM gis.layers WHERE code LIKE 'fl_%';

    RAISE NOTICE '[110] flood_analysis_runs: %',   v_runs;
    RAISE NOTICE '[110] flood_artifacts: %',        v_arts;
    RAISE NOTICE '[110] flood_run_stage_events: %', v_stages;
    RAISE NOTICE '[110] flood_run_audit: %',        v_audits;
    RAISE NOTICE '[110] raster_ingest_jobs: %',     v_jobs;
    RAISE NOTICE '[110] raster_ingest_dlq: %',      v_dlq;
    RAISE NOTICE '[110] gis.layers (fl_%): %',      v_layers;

    IF v_runs > 0 OR v_arts > 0 OR v_layers > 0 THEN
        RAISE EXCEPTION '[110] Reset không hoàn chỉnh — còn dữ liệu sót lại';
    END IF;
END;
$$;

COMMIT;
