-- Forward fix: retain every auth action added by migration 004 and make feature history fully immutable.
ALTER TABLE auth.activity_logs DROP CONSTRAINT IF EXISTS activity_logs_action_check;
ALTER TABLE auth.activity_logs ADD CONSTRAINT activity_logs_action_check CHECK(action IN(
 'register','login','login_failed','logout','refresh_token',
 'change_password','set_password','update_profile',
 'social_login','social_link','social_unlink',
 'account_locked','account_unlocked','force_logout','session_revoked',
 'password_reset_request','password_reset','password_reset_failed',
 'email_verification_sent','email_verified','token_reuse_detected',
 'user_create','user_role_change','user_active_change','user_delete',
 'admin_password_reset','system_logs_cleanup',
 'mfa_setup','mfa_verified','mfa_recovery_used',
 'map_feature_update','map_feature_restore','mobile_sync'
));

DROP TRIGGER IF EXISTS trigger_feature_versions_immutable ON gis.feature_versions;
CREATE TRIGGER trigger_feature_versions_immutable
BEFORE UPDATE OR DELETE ON gis.feature_versions
FOR EACH ROW EXECUTE FUNCTION gis.reject_feature_version_update();