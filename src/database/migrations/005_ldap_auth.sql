-- LDAP/Active Directory identity linkage.
-- Forward-only: never modify migrations 000-004.

CREATE TABLE IF NOT EXISTS auth.ldap_identities (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
    external_id VARCHAR(128) NOT NULL UNIQUE,
    login_name VARCHAR(255) NOT NULL,
    distinguished_name TEXT NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT true,
    last_verified_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (external_id <> ''),
    CHECK (login_name <> ''),
    CHECK (distinguished_name <> '')
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_ldap_login_name_active
    ON auth.ldap_identities (LOWER(login_name)) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_ldap_external_id_active
    ON auth.ldap_identities (external_id) WHERE is_active = true;

DROP TRIGGER IF EXISTS trigger_ldap_identities_updated_at ON auth.ldap_identities;
CREATE TRIGGER trigger_ldap_identities_updated_at
    BEFORE UPDATE ON auth.ldap_identities
    FOR EACH ROW EXECUTE FUNCTION core.update_updated_at_column();
