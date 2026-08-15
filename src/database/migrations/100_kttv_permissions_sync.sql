-- Migration 100: Đồng bộ ma trận phân quyền CSV v2 — thêm kttv.manual_input và kttv.match_scenario.
--
-- Nguồn: MA_TRAN_PHAN_QUYEN.csv A.1-10
--   kttv.manual_input  (Nhập dữ liệu KTTV thủ công)  : TNMT=1, XD=1, QT=1
--   kttv.match_scenario (Chuẩn bị và khớp kịch bản)  : TNMT=1, XD=1, QT=1
--
-- Migration idempotent: dùng || để merge vào object kttv hiện có, không ghi đè key khác.
-- Áp dụng cho ba vai trò vận hành; ubnd_tp không có hai quyền này (UB=0 trong CSV).

UPDATE auth.roles
SET
    permissions = jsonb_set(
        COALESCE(permissions, '{}'::jsonb),
        '{kttv}',
        COALESCE(permissions -> 'kttv', '{}'::jsonb)
            || '{"manual_input":true,"match_scenario":true}'::jsonb,
        true
    ),
    updated_at = NOW()
WHERE code IN ('system_admin', 'so_tnmt', 'so_xd');
