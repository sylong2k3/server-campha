-- Migration 098: QT (system_admin) = toàn quyền truy cập hệ thống, TRỪ đúng hai
-- nhóm chức năng bị loại trừ trong ma trận phân quyền (ghi chú G2):
--   1. Phân quyền     : users.change_role, layers.grant, api_registry.grant
--   2. Sửa/xóa bản đồ : layers.update, layers.delete, map_feature.update
--
-- Mọi resource còn lại QT đã có đủ từ 002/060/082/083/087/088/092; khoảng trống
-- duy nhất là field_report. Migration này đảo lại 091 (thu hồi
-- field_report.approve) vì QT chính là vai trò duyệt phản ánh trên web quản trị
-- — khớp danh sách reviewer trong field-report.service.js — và cấp nốt
-- create/measure. QT cũng nhận thông báo phản ánh mới cùng nhóm quản lý
-- (MANAGER_ROLES trong field-report-listener.js).
--
-- Phần `#-` chốt lại sáu quyền bị loại trừ nên migration idempotent: chạy lại
-- luôn ra đúng trạng thái trên, kể cả khi môi trường đang lệch. Thực tế trên DB
-- vận hành QT đang có layers.update = true, migration này thu hồi lại.
UPDATE auth.roles
SET permissions = jsonb_set(
        COALESCE(permissions, '{}'::jsonb),
        '{field_report}',
        '{"notify":true,"read":true,"stats":true,"approve":true,"create":true,"measure":true}'::jsonb,
        true
    )
        #- '{users,change_role}'
        #- '{layers,update}'
        #- '{layers,delete}'
        #- '{layers,grant}'
        #- '{api_registry,grant}'
        #- '{map_feature,update}',
    description_vi = 'Toàn quyền truy cập hệ thống Cẩm Phả, TRỪ chức năng phân quyền '
        '(tài khoản, lớp dữ liệu, API) và chỉnh sửa, xóa dữ liệu bản đồ.',
    description_en = 'Full access to the Cẩm Phả system except permission granting '
        '(accounts, layers, APIs) and editing or deleting map data.',
    updated_at = NOW()
WHERE code = 'system_admin';
