const db = require('../configs/database');

const IDENTITY_SELECT = `
    SELECT u.id, li.id AS ldap_identity_id, li.user_id, li.external_id, li.login_name,
           li.distinguished_name, li.is_active AS ldap_is_active,
           u.email, u.password_hash, u.full_name, u.phone, u.avatar_url,
           u.role_id, r.code AS role, r.name_vi AS role_name_vi,
           r.name_en AS role_name_en, r.permissions AS role_permissions,
           u.org_id, o.code AS org_code, o.name_vi AS org_name_vi,
           u.is_active, u.email_verified, u.email_verified_at,
           u.login_attempts, u.locked_until, u.lockout_level, u.token_version,
           u.must_change_password, u.last_login_at, u.last_login_ip
    FROM auth.ldap_identities li
    INNER JOIN auth.users u ON u.id = li.user_id
    INNER JOIN auth.roles r ON r.id = u.role_id
    LEFT JOIN auth.organizations o ON o.id = u.org_id
`;

const findByLoginName = async (loginName) => {
    const { rows } = await db.query(
        `${IDENTITY_SELECT}
         WHERE LOWER(li.login_name) = LOWER($1)
           AND li.is_active = true AND u.deleted_at IS NULL`,
        [loginName]
    );
    return rows[0] || null;
};

const findByExternalId = async (externalId) => {
    const { rows } = await db.query(
        `${IDENTITY_SELECT}
         WHERE li.external_id = $1
           AND li.is_active = true AND u.deleted_at IS NULL`,
        [externalId]
    );
    return rows[0] || null;
};

const findByUserId = async (userId) => {
    const { rows } = await db.query(
        `${IDENTITY_SELECT}
         WHERE li.user_id = $1
           AND li.is_active = true AND u.deleted_at IS NULL`,
        [userId]
    );
    return rows[0] || null;
};

const touchVerified = async (userId, { distinguishedName, loginName }) => {
    await db.query(
        `UPDATE auth.ldap_identities
         SET distinguished_name = $2, login_name = $3, last_verified_at = NOW()
         WHERE user_id = $1 AND is_active = true`,
        [userId, distinguishedName, loginName]
    );
};

const provision = async ({ email, fullName, roleCode, orgId, externalId, loginName, distinguishedName }) => {
    const client = await db.getClient();
    try {
        await client.query('BEGIN');
        const { rows } = await client.query(
            `INSERT INTO auth.users
                 (email, password_hash, full_name, role_id, org_id, email_verified, email_verified_at)
             SELECT $1, NULL, $2, r.id, o.id, true, NOW()
             FROM auth.roles r
             INNER JOIN auth.organizations o ON o.id = $4 AND o.is_active = true
             WHERE r.code = $3 AND r.is_active = true
             RETURNING id`,
            [email, fullName, roleCode, orgId]
        );
        if (!rows[0]) {throw new Error('Invalid LDAP role or organization');}

        await client.query(
            `INSERT INTO auth.ldap_identities
                 (user_id, external_id, login_name, distinguished_name)
             VALUES ($1, $2, $3, $4)`,
            [rows[0].id, externalId, loginName, distinguishedName]
        );
        await client.query('COMMIT');
        return rows[0].id;
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
};

module.exports = { findByLoginName, findByExternalId, findByUserId, touchVerified, provision };
