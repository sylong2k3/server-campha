const authService = require('../services/auth.service');
const { OK, CREATED } = require('../core/success.response');
const { getRequestContext } = require('../utils/context.util');
const { t } = require('../utils/i18n.util');
const mfaService = require('../services/mfa.service');
const tokenRepository = require('../repositories/token.repository');

const register = async (req, res) => {
    const { email, password, fullName, phone } = req.body;
    const context = getRequestContext(req);
    const result = await authService.register({ email, password, fullName, phone }, context);
    const message = result.requiresVerification
        ? t('register_verify_email', req.lang)
        : t('register_success', req.lang);
    CREATED(res, message, result);
};

const login = async (req, res) => {
    const { email, password } = req.body;
    const context = getRequestContext(req);
    const result = await authService.login({ email, password }, context);
    OK(res, t('login_success', req.lang), result);
};

const refreshToken = async (req, res) => {
    const { refreshToken } = req.body;
    const context = getRequestContext(req);
    const result = await authService.refresh(refreshToken, context);
    OK(res, t('refresh_success', req.lang), result);
};

const logout = async (req, res) => {
    const { refreshToken } = req.body;
    const context = getRequestContext(req);
    const accessTokenInfo = { jti: req.user.jti, exp: req.user.exp };
    await authService.logout(accessTokenInfo, refreshToken, req.user.id, context);
    OK(res, t('logout_success', req.lang));
};

const changePassword = async (req, res) => {
    const { oldPassword, newPassword } = req.body;
    const context = getRequestContext(req);
    const result = await authService.changePassword(req.user.id, { oldPassword, newPassword }, context);
    OK(res, result.message);
};

const setPassword = async (req, res) => {
    const { newPassword } = req.body;
    const context = getRequestContext(req);
    const result = await authService.setPassword(req.user.id, { newPassword }, context);
    OK(res, result.message, result.data);
};

const forgotPassword = async (req, res) => {
    const { email } = req.body;
    const context = getRequestContext(req);
    const result = await authService.forgotPassword({ email }, context);
    OK(res, result.message);
};

const resetPassword = async (req, res) => {
    const { token, newPassword } = req.body;
    const context = getRequestContext(req);
    const result = await authService.resetPassword({ token, newPassword }, context);
    OK(res, result.message);
};

const verifyEmail = async (req, res) => {
    const { token } = req.body;
    const context = getRequestContext(req);
    const result = await authService.verifyEmail({ token }, context);
    OK(res, result.message);
};

const resendVerification = async (req, res) => {
    const { email } = req.body;
    const context = getRequestContext(req);
    const result = await authService.resendVerification({ email }, context);
    OK(res, result.message);
};

const getMe = async (req, res) => {
    const context = getRequestContext(req);
    const user = await authService.getMe(req.user.id, context);
    OK(res, t('get_me_success', req.lang), { user });
};

const updateMe = async (req, res) => {
    const context = getRequestContext(req);
    const user = await authService.updateMe(req.user.id, req.body, req.file, context);
    OK(res, t('profile_updated', req.lang), user);
};

const googleCallback = async (req, res) => {
    const context = getRequestContext(req);
    const result = await authService.googleAuthCallback(req.user, context);
    const code = await authService.createOAuthExchangeCode(result);
    const frontendUrl = process.env.FRONTEND_URL || process.env.APP_URL || 'http://localhost:3000';
    const params = new URLSearchParams({ code, isNewUser: result.isNewUser.toString() });
    return res.redirect(`${frontendUrl}/auth/callback?${params.toString()}`);
};

const oauthExchange = async (req, res) => {
    const { code } = req.body;
    const context = getRequestContext(req);
    const result = await authService.exchangeOAuthCode({ code }, context);
    OK(res, t('login_success', req.lang), result);
};

const googleMobileLogin = async (req, res) => {
    const { idToken } = req.body;
    const context = getRequestContext(req);
    const result = await authService.googleMobileLogin({ idToken }, context);
    OK(res, t('login_success', req.lang), result);
};

const mfaSetup = async (req, res) => {
    const result = await mfaService.setup(req.body.challengeToken, getRequestContext(req));
    OK(res, t('mfa_setup_ready', req.lang), result);
};

const mfaConfirm = async (req, res) => {
    const result = await mfaService.confirm(req.body, getRequestContext(req));
    OK(res, t('mfa_enabled', req.lang), result);
};

const mfaVerify = async (req, res) => {
    const result = await mfaService.verify(req.body, getRequestContext(req));
    OK(res, t('login_success', req.lang), result);
};

const getSessions = async (req, res) => {
    const sessions = await tokenRepository.getUserSessions(req.user.id);
    OK(res, t('sessions_retrieved', req.lang), { sessions });
};

const revokeSession = async (req, res) => {
    await tokenRepository.revokeUserSession(req.user.id, req.params.id);
    OK(res, t('session_revoked_success', req.lang));
};

const revokeAllSessions = async (req, res) => {
    await Promise.all([
        tokenRepository.deleteAllUserTokens(req.user.id),
        authService.invalidateSessions(req.user.id),
    ]);
    OK(res, t('session_revoked_success', req.lang));
};

module.exports = {
    register,
    login,
    refreshToken,
    logout,
    changePassword,
    setPassword,
    forgotPassword,
    resetPassword,
    verifyEmail,
    resendVerification,
    getMe,
    updateMe,
    googleCallback,
    oauthExchange,
    googleMobileLogin,
    mfaSetup,
    mfaConfirm,
    mfaVerify,
    getSessions,
    revokeSession,
    revokeAllSessions,
};
