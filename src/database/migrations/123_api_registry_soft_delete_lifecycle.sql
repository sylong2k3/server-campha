-- Migration 123: Cho phép đăng ký lại API cho lớp bản đồ hoặc slug đã bị xóa (soft-delete)
-- Thay thế unique index toàn bảng bằng partial unique index (WHERE deleted_at IS NULL).

DROP INDEX IF EXISTS apikey.uq_api_registries_layer;
DROP INDEX IF EXISTS apikey.uq_api_registries_slug;
DROP INDEX IF EXISTS apikey.uq_api_registries_active_layer;
DROP INDEX IF EXISTS apikey.uq_api_registries_active_slug;

CREATE UNIQUE INDEX IF NOT EXISTS uq_api_registries_layer ON apikey.registries(layer_id) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_api_registries_slug ON apikey.registries(slug) WHERE deleted_at IS NULL;
