-- ============================================================================
-- Migration 001: SYSTEM LOGS — nhật ký hệ thống (khởi động, lỗi runtime, cron)
--
-- Tách biệt với auth.activity_logs (chỉ ghi hành vi người dùng auth/admin).
-- core.system_logs ghi các sự kiện tầng hệ thống: start/stop server, lỗi 5xx
-- không mong muốn, kết quả chạy cron job, cảnh báo dịch vụ ngoài (MinIO,
-- GeoServer, Earth Engine...).
--
-- Idempotent: dùng IF NOT EXISTS / DROP ... IF EXISTS để chạy lại an toàn.
-- ============================================================================

CREATE TABLE IF NOT EXISTS core.system_logs (
    id          BIGSERIAL PRIMARY KEY,
    level       VARCHAR(10) NOT NULL DEFAULT 'info',
    source      VARCHAR(50) NOT NULL,
    message     TEXT NOT NULL,
    metadata    JSONB DEFAULT '{}',
    user_id     BIGINT REFERENCES auth.users(id) ON DELETE SET NULL,
    ip_address  VARCHAR(45),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE core.system_logs DROP CONSTRAINT IF EXISTS system_logs_level_check;
ALTER TABLE core.system_logs
    ADD CONSTRAINT system_logs_level_check
    CHECK (level IN ('debug', 'info', 'warn', 'error'));

CREATE INDEX IF NOT EXISTS idx_system_logs_level_created  ON core.system_logs (level, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_system_logs_source_created ON core.system_logs (source, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_system_logs_created_at     ON core.system_logs (created_at DESC);


-- ── Seed/cập nhật quyền cho resource "system_logs" ──────────────────────────
-- Merge (||) thay vì overwrite để không mất permissions đã seed ở 000_init_schema.
-- Quyền được seed tường minh vì mọi role đều phải qua requirePermission().
UPDATE auth.roles SET permissions = permissions || '{
    "system_logs": { "read": true, "manage": true }
}'::jsonb WHERE code = 'system_admin';
