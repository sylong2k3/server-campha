const db = require('../configs/database');

const findCredential = async (userId) => {
    const { rows } = await db.query(
        `
        SELECT user_id, secret_ciphertext, secret_iv, secret_auth_tag,
               is_enabled, last_used_counter, enabled_at
        FROM auth.mfa_credentials
        WHERE user_id = $1
    `,
        [userId],
    );
    return rows[0] || null;
};

const upsertCredential = async (userId, encrypted) => {
    const { rows } = await db.query(
        `
        INSERT INTO auth.mfa_credentials
            (user_id, secret_ciphertext, secret_iv, secret_auth_tag, is_enabled)
        VALUES ($1, $2, $3, $4, false)
        ON CONFLICT (user_id) DO UPDATE SET
            secret_ciphertext = EXCLUDED.secret_ciphertext,
            secret_iv = EXCLUDED.secret_iv,
            secret_auth_tag = EXCLUDED.secret_auth_tag,
            is_enabled = false,
            last_used_counter = NULL,
            enabled_at = NULL
        RETURNING user_id, is_enabled
    `,
        [userId, encrypted.ciphertext, encrypted.iv, encrypted.authTag],
    );
    return rows[0];
};

const REQUIRED_ROLES = ['so_tnmt', 'system_admin'];

const runTransaction = async (work) => {
    const client = await db.getClient();
    try {
        await client.query('BEGIN');
        const result = await work(client);
        await client.query('COMMIT');
        return result;
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
};

const lockEligibleUser = async (client, userId, tokenVersion) => {
    const { rowCount } = await client.query(
        `
        SELECT u.id
        FROM auth.users u
        JOIN auth.roles r ON r.id = u.role_id
        WHERE u.id = $1 AND u.is_active = true AND u.token_version = $2
          AND r.code = ANY($3::varchar[])
        FOR UPDATE OF u
    `,
        [userId, tokenVersion, REQUIRED_ROLES],
    );
    return rowCount === 1;
};

const lockChallenge = async (client, challengeId, userId, purpose) => {
    const { rowCount } = await client.query(
        `
        SELECT id FROM auth.mfa_challenges
        WHERE id = $1 AND user_id = $2 AND purpose = $3
          AND used_at IS NULL AND expires_at > NOW()
        FOR UPDATE
    `,
        [challengeId, userId, purpose],
    );
    return rowCount === 1;
};

const saveSessionAndLogin = async (client, userId, session) => {
    await client.query(
        `
        INSERT INTO auth.refresh_tokens (user_id, token_hash, device_info, expires_at)
        VALUES ($1, $2, $3, $4)
    `,
        [userId, session.tokenHash, JSON.stringify(session.deviceInfo || {}), session.expiresAt],
    );
    await client.query(
        `
        UPDATE auth.users
        SET login_attempts = 0, locked_until = NULL, lockout_level = 0,
            last_login_at = NOW(), last_login_ip = $2
        WHERE id = $1
    `,
        [userId, session.ipAddress || null],
    );
};

const completeEnrollment = async ({
    challengeId,
    userId,
    counter,
    recoveryCodeHashes,
    tokenVersion,
    session,
}) =>
    runTransaction(async (client) => {
        if (!(await lockEligibleUser(client, userId, tokenVersion))) {
            return 'user_invalid';
        }
        if (!(await lockChallenge(client, challengeId, userId, 'setup'))) {
            return 'challenge_invalid';
        }

        const { rowCount } = await client.query(
            `
        UPDATE auth.mfa_credentials
        SET is_enabled = true, enabled_at = NOW(), last_used_counter = $2
        WHERE user_id = $1 AND is_enabled = false
    `,
            [userId, counter],
        );
        if (rowCount !== 1) {
            return 'already_enabled';
        }

        await client.query('DELETE FROM auth.mfa_recovery_codes WHERE user_id = $1', [userId]);
        await client.query(
            `
        INSERT INTO auth.mfa_recovery_codes (user_id, code_hash)
        SELECT $1, unnest($2::char(64)[])
    `,
            [userId, recoveryCodeHashes],
        );
        await saveSessionAndLogin(client, userId, session);
        await client.query('UPDATE auth.mfa_challenges SET used_at = NOW() WHERE id = $1', [
            challengeId,
        ]);
        return 'ok';
    });

const completeLogin = async ({
    challengeId,
    userId,
    counter,
    recoveryCodeHash,
    tokenVersion,
    session,
}) =>
    runTransaction(async (client) => {
        if (!(await lockEligibleUser(client, userId, tokenVersion))) {
            return 'user_invalid';
        }
        if (!(await lockChallenge(client, challengeId, userId, 'login'))) {
            return 'challenge_invalid';
        }

        const factorResult = recoveryCodeHash
            ? await client.query(
                  `
            UPDATE auth.mfa_recovery_codes
            SET used_at = NOW()
            WHERE user_id = $1 AND code_hash = $2 AND used_at IS NULL
        `,
                  [userId, recoveryCodeHash],
              )
            : await client.query(
                  `
            UPDATE auth.mfa_credentials
            SET last_used_counter = $2
            WHERE user_id = $1 AND is_enabled = true
              AND (last_used_counter IS NULL OR last_used_counter < $2)
        `,
                  [userId, counter],
              );
        if (factorResult.rowCount !== 1) {
            return 'code_invalid';
        }

        await saveSessionAndLogin(client, userId, session);
        await client.query('UPDATE auth.mfa_challenges SET used_at = NOW() WHERE id = $1', [
            challengeId,
        ]);
        return 'ok';
    });

const createChallenge = async ({ userId, tokenHash, purpose, expiresAt }) => {
    const client = await db.getClient();
    try {
        await client.query('BEGIN');
        await client.query('SELECT id FROM auth.users WHERE id = $1 FOR UPDATE', [userId]);
        await client.query(
            `
            DELETE FROM auth.mfa_challenges
            WHERE user_id = $1 AND purpose = $2 AND used_at IS NULL
        `,
            [userId, purpose],
        );
        const { rows } = await client.query(
            `
            INSERT INTO auth.mfa_challenges (user_id, token_hash, purpose, expires_at)
            VALUES ($1, $2, $3, $4)
            RETURNING id, user_id, purpose, expires_at
        `,
            [userId, tokenHash, purpose, expiresAt],
        );
        await client.query('COMMIT');
        return rows[0];
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
};

const findChallenge = async (tokenHash, purpose) => {
    const { rows } = await db.query(
        `
        SELECT id, user_id, purpose, expires_at
        FROM auth.mfa_challenges
        WHERE token_hash = $1 AND purpose = $2
          AND used_at IS NULL AND expires_at > NOW()
    `,
        [tokenHash, purpose],
    );
    return rows[0] || null;
};

module.exports = {
    findCredential,
    upsertCredential,
    completeEnrollment,
    completeLogin,
    createChallenge,
    findChallenge,
};
