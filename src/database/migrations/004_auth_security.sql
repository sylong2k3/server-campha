-- Sprint 1: session invalidation, progressive lockout and MFA.
-- Forward-only: never modify migrations 000-003.

ALTER TABLE auth.users
    ADD COLUMN IF NOT EXISTS token_version INT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS lockout_level SMALLINT NOT NULL DEFAULT 0;

ALTER TABLE auth.users DROP CONSTRAINT IF EXISTS users_token_version_check;
ALTER TABLE auth.users ADD CONSTRAINT users_token_version_check CHECK (token_version >= 0);
ALTER TABLE auth.users DROP CONSTRAINT IF EXISTS users_lockout_level_check;
ALTER TABLE auth.users ADD CONSTRAINT users_lockout_level_check CHECK (lockout_level BETWEEN 0 AND 3);

CREATE TABLE IF NOT EXISTS auth.mfa_credentials (
    user_id BIGINT PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    secret_ciphertext TEXT NOT NULL,
    secret_iv VARCHAR(32) NOT NULL,
    secret_auth_tag VARCHAR(32) NOT NULL,
    is_enabled BOOLEAN NOT NULL DEFAULT false,
    last_used_counter BIGINT,
    enabled_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS trigger_mfa_credentials_updated_at ON auth.mfa_credentials;
CREATE TRIGGER trigger_mfa_credentials_updated_at
    BEFORE UPDATE ON auth.mfa_credentials
    FOR EACH ROW EXECUTE FUNCTION core.update_updated_at_column();

CREATE TABLE IF NOT EXISTS auth.mfa_recovery_codes (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    code_hash CHAR(64) NOT NULL,
    used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (user_id, code_hash)
);
CREATE INDEX IF NOT EXISTS idx_mfa_recovery_active
    ON auth.mfa_recovery_codes (user_id) WHERE used_at IS NULL;

CREATE TABLE IF NOT EXISTS auth.mfa_challenges (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    token_hash CHAR(64) NOT NULL UNIQUE,
    purpose VARCHAR(10) NOT NULL CHECK (purpose IN ('setup', 'login')),
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_mfa_challenges_active
    ON auth.mfa_challenges (token_hash, expires_at) WHERE used_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_mfa_active_challenge
    ON auth.mfa_challenges (user_id, purpose) WHERE used_at IS NULL;

-- OAuth web callback chỉ redirect exchange code một lần. MFA challenge không xuất hiện
-- trong URL/browser history; challenge được tạo sau khi exchange code.
ALTER TABLE auth.oauth_exchange_codes
    ALTER COLUMN access_token DROP NOT NULL,
    ALTER COLUMN refresh_token DROP NOT NULL,
    ADD COLUMN IF NOT EXISTS mfa_required BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE auth.oauth_exchange_codes DROP CONSTRAINT IF EXISTS oauth_exchange_payload_check;
ALTER TABLE auth.oauth_exchange_codes ADD CONSTRAINT oauth_exchange_payload_check CHECK (
    (mfa_required = true AND access_token IS NULL AND refresh_token IS NULL)
    OR
    (mfa_required = false AND access_token IS NOT NULL AND refresh_token IS NOT NULL)
);

ALTER TABLE auth.activity_logs DROP CONSTRAINT IF EXISTS activity_logs_action_check;
ALTER TABLE auth.activity_logs ADD CONSTRAINT activity_logs_action_check CHECK (action IN (
    'register', 'login', 'login_failed', 'logout', 'refresh_token',
    'change_password', 'set_password', 'update_profile',
    'social_login', 'social_link', 'social_unlink',
    'account_locked', 'account_unlocked', 'force_logout', 'session_revoked',
    'password_reset_request', 'password_reset', 'password_reset_failed',
    'email_verification_sent', 'email_verified', 'token_reuse_detected',
    'user_create', 'user_role_change', 'user_active_change', 'user_delete',
    'admin_password_reset', 'system_logs_cleanup',
    'mfa_setup', 'mfa_verified', 'mfa_recovery_used'
));
