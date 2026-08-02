const mfaRepository = require('../repositories/mfa.repository');
const userRepository = require('../repositories/user.repository');
const { generateTokenPair } = require('../utils/tokenManager.util');
const { generateRandomToken, hashToken } = require('../utils/cryptoHelper.util');
const {
    createSecret,
    buildOtpAuthUri,
    encryptSecret,
    decryptSecret,
    verifyTotp,
} = require('../utils/totp.util');
const { Api400Error, Api401Error, Api409Error } = require('../core/error.response');
const { t } = require('../utils/i18n.util');
const activityLogger = require('../utils/activityLogger.util');

const REQUIRED_ROLES = new Set(['so_tnmt', 'system_admin']);
const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const RECOVERY_CODE_COUNT = 10;

const isRequiredForRole = (role) => process.env.MFA_ENABLED === 'true' && REQUIRED_ROLES.has(role);

const createChallenge = async (userId, purpose) => {
    const token = generateRandomToken(32);
    const expiresAt = new Date(Date.now() + CHALLENGE_TTL_MS);
    await mfaRepository.createChallenge({
        userId,
        tokenHash: hashToken(token),
        purpose,
        expiresAt,
    });
    return { challengeToken: token, purpose, expiresAt };
};

const beginLogin = async (user) => {
    if (!isRequiredForRole(user.role)) {
        return null;
    }
    const credential = await mfaRepository.findCredential(user.id);
    return createChallenge(user.id, credential?.is_enabled ? 'login' : 'setup');
};

const setup = async (challengeToken, context = {}) => {
    const challenge = await mfaRepository.findChallenge(hashToken(challengeToken), 'setup');
    if (!challenge) {
        throw new Api401Error(t('mfa_challenge_invalid', context.lang));
    }
    const user = await userRepository.findById(challenge.user_id);
    if (!user || !user.is_active || !isRequiredForRole(user.role)) {
        throw new Api401Error(t('mfa_challenge_invalid', context.lang));
    }
    const secret = createSecret();
    await mfaRepository.upsertCredential(user.id, encryptSecret(secret));
    return {
        secret,
        otpAuthUri: buildOtpAuthUri({ secret, account: user.email }),
        challengeToken,
        expiresAt: challenge.expires_at,
    };
};

const buildTokens = (user) =>
    generateTokenPair({
        userId: user.id,
        email: user.email,
        role: user.role,
        tokenVersion: user.token_version,
    });

const buildSession = (tokens, context) => ({
    tokenHash: hashToken(tokens.refreshToken),
    deviceInfo: {
        ipAddress: context.ipAddress || null,
        userAgent: context.userAgent || null,
    },
    expiresAt: tokens.refreshExpiresAt,
    ipAddress: context.ipAddress || null,
});

const tokenResult = (user, tokens, lang) => ({
    user: sanitizeUser(user, lang),
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
});

const confirm = async ({ challengeToken, code }, context = {}) => {
    const challenge = await mfaRepository.findChallenge(hashToken(challengeToken), 'setup');
    if (!challenge) {
        throw new Api401Error(t('mfa_challenge_invalid', context.lang));
    }
    const credential = await mfaRepository.findCredential(challenge.user_id);
    if (!credential || credential.is_enabled) {
        throw new Api409Error(t('mfa_already_enabled', context.lang));
    }
    const secret = decryptSecret({
        ciphertext: credential.secret_ciphertext,
        iv: credential.secret_iv,
        authTag: credential.secret_auth_tag,
    });
    const counter = verifyTotp(secret, code);
    if (counter === null) {
        throw new Api401Error(t('mfa_code_invalid', context.lang));
    }
    const recoveryCodes = Array.from({ length: RECOVERY_CODE_COUNT }, () =>
        generateRandomToken(9).toUpperCase(),
    );
    const user = await userRepository.findById(challenge.user_id);
    if (!user?.is_active || !isRequiredForRole(user.role)) {
        throw new Api401Error(t('mfa_challenge_invalid', context.lang));
    }
    const tokens = buildTokens(user);
    const status = await mfaRepository.completeEnrollment({
        challengeId: challenge.id,
        userId: user.id,
        counter,
        recoveryCodeHashes: recoveryCodes.map(hashToken),
        tokenVersion: user.token_version,
        session: buildSession(tokens, context),
    });
    if (status === 'already_enabled') {
        throw new Api409Error(t('mfa_already_enabled', context.lang));
    }
    if (status !== 'ok') {
        throw new Api401Error(t('mfa_challenge_invalid', context.lang));
    }
    await log(user.id, 'mfa_setup', context);
    return { ...tokenResult(user, tokens, context.lang), recoveryCodes };
};

const verify = async ({ challengeToken, code, recoveryCode }, context = {}) => {
    if ((!code && !recoveryCode) || (code && recoveryCode)) {
        throw new Api400Error(t('mfa_code_required', context.lang));
    }
    const challenge = await mfaRepository.findChallenge(hashToken(challengeToken), 'login');
    if (!challenge) {
        throw new Api401Error(t('mfa_challenge_invalid', context.lang));
    }
    const credential = await mfaRepository.findCredential(challenge.user_id);
    if (!credential?.is_enabled) {
        throw new Api401Error(t('mfa_challenge_invalid', context.lang));
    }

    let action = 'mfa_verified';
    let counter = null;
    let recoveryCodeHash = null;
    if (recoveryCode) {
        recoveryCodeHash = hashToken(recoveryCode.toUpperCase());
        action = 'mfa_recovery_used';
    } else {
        const secret = decryptSecret({
            ciphertext: credential.secret_ciphertext,
            iv: credential.secret_iv,
            authTag: credential.secret_auth_tag,
        });
        counter = verifyTotp(secret, code);
        if (counter === null) {
            throw new Api401Error(t('mfa_code_invalid', context.lang));
        }
    }
    const user = await userRepository.findById(challenge.user_id);
    if (!user?.is_active || !isRequiredForRole(user.role)) {
        throw new Api401Error(t('mfa_challenge_invalid', context.lang));
    }
    const tokens = buildTokens(user);
    const status = await mfaRepository.completeLogin({
        challengeId: challenge.id,
        userId: user.id,
        counter,
        recoveryCodeHash,
        tokenVersion: user.token_version,
        session: buildSession(tokens, context),
    });
    if (status === 'code_invalid') {
        throw new Api401Error(t('mfa_code_invalid', context.lang));
    }
    if (status !== 'ok') {
        throw new Api401Error(t('mfa_challenge_invalid', context.lang));
    }
    await log(user.id, action, context);
    return tokenResult(user, tokens, context.lang);
};

const sanitizeUser = (user, lang = 'vi') => ({
    id: user.id,
    email: user.email,
    fullName: user.full_name,
    phone: user.phone,
    avatarUrl: user.avatar_url,
    role: user.role,
    roleName: lang === 'en' ? user.role_name_en : user.role_name_vi,
    organization: user.org_id
        ? { id: user.org_id, code: user.org_code, name: user.org_name_vi }
        : null,
    mustChangePassword: user.must_change_password,
});

const log = (userId, action, context) =>
    activityLogger.logActivity('[MFA]', {
        userId,
        action,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
    });

module.exports = { isRequiredForRole, beginLogin, setup, confirm, verify };
