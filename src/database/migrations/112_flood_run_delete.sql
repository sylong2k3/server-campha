-- Migration 112: cho phép xóa vĩnh viễn các lượt phân tích ngập lụt đã kết thúc.
--
-- `gis.flood_run_audit.analysis_run_id` / `artifact_id` hiện tham chiếu
-- gis.flood_analysis_runs(id) / gis.flood_artifacts(id) mà không có ON DELETE,
-- nên DELETE một run sẽ vi phạm FK nếu run đó từng có audit log (submit, rerun,
-- cancel...). Đổi sang ON DELETE SET NULL để giữ lại lịch sử thao tác (trong
-- audit.metadata) ngay cả sau khi run gốc bị xóa.
--
-- gis.flood_artifacts và gis.flood_run_stage_events đã có
-- ON DELETE CASCADE trên analysis_run_id (xem 080_flood_domain.sql) nên
-- chúng tự động bị xóa theo run — không cần sửa ở đây.

ALTER TABLE gis.flood_run_audit
    DROP CONSTRAINT IF EXISTS flood_run_audit_analysis_run_id_fkey;
ALTER TABLE gis.flood_run_audit
    ADD CONSTRAINT flood_run_audit_analysis_run_id_fkey
        FOREIGN KEY (analysis_run_id) REFERENCES gis.flood_analysis_runs(id)
        ON DELETE SET NULL;

ALTER TABLE gis.flood_run_audit
    DROP CONSTRAINT IF EXISTS flood_run_audit_artifact_id_fkey;
ALTER TABLE gis.flood_run_audit
    ADD CONSTRAINT flood_run_audit_artifact_id_fkey
        FOREIGN KEY (artifact_id) REFERENCES gis.flood_artifacts(id)
        ON DELETE SET NULL;

-- Ghi nhận hành động xóa run trong audit trail.
ALTER TABLE gis.flood_run_audit
    DROP CONSTRAINT IF EXISTS flood_run_audit_action_check;
ALTER TABLE gis.flood_run_audit
    ADD CONSTRAINT flood_run_audit_action_check
        CHECK (action IN (
            'submit', 'rerun', 'cancel', 'publish', 'unpublish',
            'retry_publish', 'discard_artifact', 'delete_run'
        ));
