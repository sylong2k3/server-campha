-- Migration 109: Chuyển params_snapshot của trend runs cũ từ analysisYear → monitorStart/monitorEnd
--
-- Bối cảnh:
--   Model cũ (TREND_FINAL): lưu params_snapshot.analysisYear (integer, e.g. 2025)
--   Model mới (TREND_MONITORING_V1): lưu params_snapshot.monitorStart + monitorEnd (ISO date string)
--
-- Mục tiêu:
--   1. Patch params_snapshot: xóa analysisYear, thêm monitorStart/monitorEnd
--   2. Patch result_metadata: thêm monitorStart/monitorEnd để public client hiển thị đúng kỳ
--      (Client đọc từ resultMetadata = result_metadata, không đọc params_snapshot)
--   3. Xóa artifact new_flood (không còn được tạo trong model mới)
--   4. Rollback khả thi: _migratedFromYear được giữ lại trong params_snapshot
--
-- Quy tắc chuyển đổi:
--   analysisYear: N → monitorStart: 'N-01-01', monitorEnd: 'N-12-31'
--   (Xấp xỉ: model cũ phân tích 4 mùa trong năm, không phải kỳ liên tục. Dữ liệu
--    result_metadata cũ giữ nguyên — chỉ bổ sung field mới, không ghi đè.)
--
-- Phạm vi: module = 'trend', có params_snapshot.analysisYear, giá trị là số 4 chữ số.
-- An toàn với run FAILED/CANCELLED (patch params_snapshot), chỉ patch result_metadata
-- khi status = 'SUCCEEDED' và result_metadata IS NOT NULL.
--
-- Rollback:
--   UPDATE gis.flood_analysis_runs
--   SET params_snapshot = params_snapshot
--       - 'monitorStart' - 'monitorEnd'
--       || jsonb_build_object('analysisYear', params_snapshot->>'_migratedFromYear')
--   WHERE module = 'trend' AND params_snapshot ? '_migratedFromYear';

-- ── DRY-RUN PREVIEW (chạy riêng trước khi thực thi) ──────────────────────────
-- Xem các run sẽ bị ảnh hưởng:
--
-- SELECT
--     id,
--     status,
--     pipeline_version,
--     (params_snapshot->>'analysisYear')::int AS old_year,
--     params_snapshot->>'monitorStart'        AS existing_monitorStart,
--     result_metadata IS NOT NULL              AS has_result_metadata
-- FROM gis.flood_analysis_runs
-- WHERE module = 'trend'
--   AND params_snapshot ? 'analysisYear'
--   AND (params_snapshot->>'analysisYear') ~ '^\d{4}$'
-- ORDER BY id;
--
-- Xem artifact new_flood sẽ bị xóa/reset:
--
-- SELECT a.id, a.artifact_code, a.publish_status, a.analysis_run_id, r.status AS run_status
-- FROM gis.flood_artifacts a
-- JOIN gis.flood_analysis_runs r ON r.id = a.analysis_run_id
-- WHERE a.artifact_code = 'new_flood';
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- ── Bước 1: Patch params_snapshot ────────────────────────────────────────────
-- Xóa analysisYear, thêm monitorStart / monitorEnd / _migratedFromYear.
-- Áp dụng cho mọi status (params_snapshot là input config, không phụ thuộc vào kết quả).

UPDATE gis.flood_analysis_runs
SET params_snapshot = (params_snapshot - 'analysisYear')
    || jsonb_build_object(
        'monitorStart',
        to_char(
            make_date((params_snapshot ->> 'analysisYear')::int, 1, 1),
            'YYYY-MM-DD'
        ),
        'monitorEnd',
        to_char(
            make_date((params_snapshot ->> 'analysisYear')::int, 12, 31),
            'YYYY-MM-DD'
        ),
        '_migratedFromYear',
        (params_snapshot ->> 'analysisYear')::int
    )
WHERE module = 'trend'
  AND params_snapshot ? 'analysisYear'
  AND (params_snapshot ->> 'analysisYear') ~ '^\d{4}$';

-- ── Bước 2: Patch result_metadata ────────────────────────────────────────────
-- Thêm monitorStart / monitorEnd vào result_metadata để public client đọc được.
-- Chỉ patch run SUCCEEDED có result_metadata hợp lệ.
-- Dùng || (merge) — không ghi đè field đã tồn tại nếu run mới đã có.

UPDATE gis.flood_analysis_runs
SET result_metadata = result_metadata
    || jsonb_build_object(
        'monitorStart',
        to_char(
            make_date((params_snapshot ->> '_migratedFromYear')::int, 1, 1),
            'YYYY-MM-DD'
        ),
        'monitorEnd',
        to_char(
            make_date((params_snapshot ->> '_migratedFromYear')::int, 12, 31),
            'YYYY-MM-DD'
        )
    )
WHERE module = 'trend'
  AND status = 'SUCCEEDED'
  AND params_snapshot ? '_migratedFromYear'
  AND result_metadata IS NOT NULL
  AND NOT (result_metadata ? 'monitorStart');  -- Không ghi đè run mới đã có sẵn field này

-- ── Bước 3: Xóa artifact new_flood chưa publish ──────────────────────────────
-- new_flood không còn được tạo ra trong TREND_MONITORING_V1.
-- Artifact chưa publish xóa hẳn (không ảnh hưởng gì đến GeoServer / gis.layers).

DELETE FROM gis.flood_artifacts
WHERE artifact_code = 'new_flood'
  AND publish_status = 'unpublished';

-- ── Bước 4: Unpublish artifact new_flood đã publish ──────────────────────────
-- Nếu có new_flood đã publish lên GeoServer, hạ publish_status về 'unpublished'.
-- Admin cần tự xóa tay trên GeoServer (migration không thể gọi GeoServer REST API).
-- Xóa workspace/layer_name/style_name để run-executor không cố dùng lại.

UPDATE gis.flood_artifacts
SET publish_status = 'unpublished',
    published_at   = NULL,
    workspace      = NULL,
    layer_name     = NULL,
    style_name     = NULL,
    registry_layer_id = NULL
WHERE artifact_code = 'new_flood'
  AND publish_status IN ('published', 'publishing', 'failed');

-- ── Bước 5: Xóa gis.layers entry của new_flood ────────────────────────────────
-- Các layer được ingest vào gis.layers có code 'fl_trend_new_flood_<id>'.

DELETE FROM gis.layers
WHERE code LIKE 'fl_trend_new_flood_%';

-- ── Xác nhận kết quả (log dạng DO block để dễ đọc trong psql output) ─────────

DO $$
DECLARE
    v_params_patched   int;
    v_metadata_patched int;
    v_artifacts_deleted int;
    v_artifacts_reset   int;
    v_layers_deleted    int;
BEGIN
    SELECT COUNT(*) INTO v_params_patched
    FROM gis.flood_analysis_runs
    WHERE module = 'trend' AND params_snapshot ? '_migratedFromYear';

    SELECT COUNT(*) INTO v_metadata_patched
    FROM gis.flood_analysis_runs
    WHERE module = 'trend'
      AND status = 'SUCCEEDED'
      AND params_snapshot ? '_migratedFromYear'
      AND result_metadata ? 'monitorStart';

    SELECT COUNT(*) INTO v_artifacts_deleted
    FROM gis.flood_artifacts
    WHERE artifact_code = 'new_flood';

    SELECT COUNT(*) INTO v_artifacts_reset
    FROM gis.flood_artifacts
    WHERE artifact_code = 'new_flood' AND publish_status = 'unpublished';

    SELECT COUNT(*) INTO v_layers_deleted
    FROM gis.layers WHERE code LIKE 'fl_trend_new_flood_%';

    RAISE NOTICE '[109] params_snapshot patched: %', v_params_patched;
    RAISE NOTICE '[109] result_metadata patched: %',   v_metadata_patched;
    RAISE NOTICE '[109] new_flood artifacts remaining: % (reset: %)', v_artifacts_deleted, v_artifacts_reset;
    RAISE NOTICE '[109] new_flood layers remaining: %', v_layers_deleted;
END;
$$;

COMMIT;
