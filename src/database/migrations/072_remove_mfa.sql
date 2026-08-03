-- Retire MFA/TOTP after product decision.
-- Forward-only: migration 004 remains immutable for checksum compatibility.

DELETE FROM auth.oauth_exchange_codes
WHERE access_token IS NULL OR refresh_token IS NULL;

ALTER TABLE auth.oauth_exchange_codes
    DROP CONSTRAINT IF EXISTS oauth_exchange_payload_check;

ALTER TABLE auth.oauth_exchange_codes
    ALTER COLUMN access_token SET NOT NULL,
    ALTER COLUMN refresh_token SET NOT NULL,
    DROP COLUMN IF EXISTS mfa_required;

DROP TABLE IF EXISTS auth.mfa_challenges;
DROP TABLE IF EXISTS auth.mfa_recovery_codes;
DROP TABLE IF EXISTS auth.mfa_credentials;
