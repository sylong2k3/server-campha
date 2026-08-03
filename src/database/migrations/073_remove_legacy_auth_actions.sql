-- Remove unsupported legacy authentication actions from the current audit contract.
DELETE FROM auth.activity_logs
WHERE action IN ('mfa_setup', 'mfa_verified', 'mfa_recovery_used');

ALTER TABLE auth.activity_logs
    DROP CONSTRAINT IF EXISTS activity_logs_action_check;

ALTER TABLE auth.activity_logs
    ADD CONSTRAINT activity_logs_action_check CHECK (action IN (
        'register', 'login', 'login_failed', 'logout', 'refresh_token',
        'change_password', 'set_password', 'update_profile',
        'social_login', 'social_link', 'social_unlink',
        'account_locked', 'account_unlocked', 'force_logout', 'session_revoked',
        'password_reset_request', 'password_reset', 'password_reset_failed',
        'email_verification_sent', 'email_verified', 'token_reuse_detected',
        'user_create', 'user_role_change', 'user_active_change', 'user_delete',
        'admin_password_reset', 'system_logs_cleanup',
        'map_feature_update', 'map_feature_restore', 'mobile_sync'
    ));
