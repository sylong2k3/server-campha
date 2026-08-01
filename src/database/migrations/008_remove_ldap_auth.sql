-- Retire LDAP/Active Directory authentication after the product decision to use
-- local password and Google OAuth identities only.
-- Migration 005 remains immutable because it may already be checksummed.

DO $$
BEGIN
    IF to_regclass('auth.ldap_identities') IS NOT NULL THEN
        -- LDAP-only users cannot authenticate after this deployment. Disable them
        -- rather than inventing credentials or silently linking another provider.
        UPDATE auth.users u
        SET is_active = false,
            token_version = token_version + 1,
            updated_at = NOW()
        FROM auth.ldap_identities li
        WHERE li.user_id = u.id
          AND u.password_hash IS NULL
          AND NOT EXISTS (
              SELECT 1
              FROM auth.social_accounts sa
              WHERE sa.user_id = u.id
                AND sa.provider = 'google'
                AND sa.is_active = true
          );

        DELETE FROM auth.refresh_tokens rt
        USING auth.ldap_identities li
        WHERE rt.user_id = li.user_id;

        DROP TABLE auth.ldap_identities;
    END IF;
END
$$;
