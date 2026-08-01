-- Migration 003: mở rộng audit action cho quản trị nhật ký hệ thống.
-- Forward-only: không sửa migration 000 đã áp dụng.

ALTER TABLE auth.activity_logs
    DROP CONSTRAINT IF EXISTS activity_logs_action_check;

ALTER TABLE auth.activity_logs
    ADD CONSTRAINT activity_logs_action_check
    CHECK (action IN (
        'register',
        'login',
        'login_failed',
        'logout',
        'refresh_token',
        'change_password',
        'social_login',
        'social_link',
        'social_unlink',
        'account_locked',
        'account_unlocked',
        'force_logout',
        'password_reset_request',
        'password_reset',
        'password_reset_failed',
        'email_verification_sent',
        'email_verified',
        'token_reuse_detected',
        'user_create',
        'user_role_change',
        'user_active_change',
        'user_delete',
        'admin_password_reset',
        'system_logs_cleanup'
    ));
