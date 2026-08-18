-- Migration 111: Xóa snapshot phân loại rừng tháng 7/2026.
--
-- Bối cảnh:
--   Snapshot id=4 (year=2026, month=7, attempt=1, status=published) được sinh bởi
--   cron trigger ngày 2026-08-17. Cần xóa để tái chạy hoặc dọn dữ liệu thử nghiệm.
--
-- Phạm vi:
--   - DELETE forest.forest_snapshots WHERE year=2026 AND month=7
--     → CASCADE xóa forest_district_areas và forest_district_exports liên quan
--   - gis.raster_ingest_jobs (rasterIngestJobId=21) KHÔNG bị xóa — tự expire
--   - Không ảnh hưởng snapshot tháng 6/2026 (id=3) và tháng 3/2026 (id=6)
--
-- Rollback:
--   Không có rollback tự động. Backup DB trước khi chạy nếu cần phục hồi.

-- ── DRY-RUN PREVIEW ──────────────────────────────────────────────────────────
-- SELECT id, year, month, attempt, status, trigger, computed_at
-- FROM forest.forest_snapshots
-- WHERE year = 2026 AND month = 7;
--
-- SELECT COUNT(*) AS district_areas
-- FROM forest.forest_district_areas da
-- JOIN forest.forest_snapshots s ON s.id = da.snapshot_id
-- WHERE s.year = 2026 AND s.month = 7;
--
-- SELECT COUNT(*) AS district_exports
-- FROM forest.forest_district_exports de
-- JOIN forest.forest_snapshots s ON s.id = de.snapshot_id
-- WHERE s.year = 2026 AND s.month = 7;
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

DELETE FROM forest.forest_snapshots
WHERE year = 2026 AND month = 7;

-- Xác nhận snapshot đã bị xóa
DO $$
DECLARE
    v_remaining int;
BEGIN
    SELECT COUNT(*) INTO v_remaining
    FROM forest.forest_snapshots
    WHERE year = 2026 AND month = 7;

    IF v_remaining > 0 THEN
        RAISE EXCEPTION '[111] Còn % snapshot tháng 7/2026 — xóa thất bại', v_remaining;
    END IF;

    RAISE NOTICE '[111] Snapshot forest_classification 2026/07 đã được xóa thành công.';
END;
$$;

COMMIT;
