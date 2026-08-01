jest.mock('../../repositories/user.repository');
jest.mock('../../repositories/token.repository');
jest.mock('../../repositories/social.repository');
jest.mock('../../repositories/ldap.repository');
jest.mock('../ldap.service');
jest.mock('../mfa.service');
jest.mock('../../utils/cryptoHelper.util');
jest.mock('../../utils/tokenManager.util');
jest.mock('../../utils/activityLogger.util', () => ({ logActivity: jest.fn().mockResolvedValue() }));
jest.mock('../../utils/mailer.util');

const userRepository = require('../../repositories/user.repository');
const tokenRepository = require('../../repositories/token.repository');
const ldapRepository = require('../../repositories/ldap.repository');
const ldapService = require('../ldap.service');
const mfaService = require('../mfa.service');
const cryptoHelper = require('../../utils/cryptoHelper.util');
const tokenManager = require('../../utils/tokenManager.util');
const authService = require('../auth.service');
const { Api401Error, Api503Error } = require('../../core/error.response');

const user = {
    id: 7,
    email: 'staff@campha.gov.vn',
    role: 'so_xd',
    token_version: 2,
    is_active: true,
    email_verified: true,
    locked_until: null,
};
const directoryUser = {
    externalId: '00112233',
    loginName: 'staff',
    distinguishedName: 'CN=Staff,DC=campha,DC=local',
};
const context = { lang: 'vi', ipAddress: '127.0.0.1', userAgent: 'jest' };

describe('LDAP auth lifecycle', () => {
    beforeEach(() => {
        jest.resetAllMocks();
        mfaService.beginLogin.mockResolvedValue(null);
        tokenManager.generateTokenPair.mockReturnValue({
            accessToken: 'access', refreshToken: 'refresh', refreshExpiresAt: new Date(Date.now() + 10000),
        });
        cryptoHelper.hashToken.mockReturnValue('refresh-hash');
        userRepository.updateLoginSuccess.mockResolvedValue();
        tokenRepository.saveRefreshToken.mockResolvedValue();
        ldapRepository.touchVerified.mockResolvedValue();
        ldapService.prepareLogin.mockResolvedValue({ user, directoryUser });
        ldapService.verifyPassword.mockResolvedValue();
    });

    test('LDAP success phát JWT và lưu refresh hash', async () => {
        const result = await authService.ldapLogin({ username: 'staff', password: 'secret' }, context);
        expect(ldapService.verifyPassword).toHaveBeenCalledWith(directoryUser.distinguishedName, 'secret');
        expect(ldapRepository.touchVerified).toHaveBeenCalledWith(user.id, directoryUser);
        expect(tokenRepository.saveRefreshToken).toHaveBeenCalledWith(expect.objectContaining({
            userId: 7, tokenHash: 'refresh-hash',
        }));
        expect(result).toMatchObject({ accessToken: 'access', refreshToken: 'refresh' });
    });

    test('AD outage trả 503, không tăng wrong-password counter', async () => {
        ldapService.verifyPassword.mockRejectedValue(new ldapService.LdapUnavailableError());
        await expect(authService.ldapLogin({ username: 'staff', password: 'secret' }, context))
            .rejects.toBeInstanceOf(Api503Error);
        expect(userRepository.incrementLoginAttempts).not.toHaveBeenCalled();
        expect(tokenRepository.saveRefreshToken).not.toHaveBeenCalled();
    });

    test('wrong password tăng local lock và trả generic 401', async () => {
        ldapService.verifyPassword.mockRejectedValue(new ldapService.LdapAuthenticationError());
        userRepository.incrementLoginAttempts.mockResolvedValue({ login_attempts: 1 });
        await expect(authService.ldapLogin({ username: 'staff', password: 'wrong' }, context))
            .rejects.toBeInstanceOf(Api401Error);
        expect(userRepository.incrementLoginAttempts).toHaveBeenCalledWith(7, 3, 15);
    });

    test('local login bị chặn khi account đã link LDAP', async () => {
        userRepository.findByEmail.mockResolvedValue({ ...user, password_hash: 'legacy-hash' });
        ldapRepository.findByUserId.mockResolvedValue({ user_id: 7 });
        await expect(authService.login({ email: user.email, password: 'secret' }, context))
            .rejects.toBeInstanceOf(Api401Error);
        expect(cryptoHelper.comparePassword).not.toHaveBeenCalled();
    });

    test('refresh AD outage không consume refresh token', async () => {
        tokenManager.verifyRefreshToken.mockReturnValue({ userId: 7, tokenVersion: 2 });
        cryptoHelper.hashToken.mockReturnValue('stored-hash');
        tokenRepository.findRefreshToken.mockResolvedValue({ device_info: 'jest' });
        userRepository.findById.mockResolvedValue(user);
        ldapService.verifyLinkedAccountActive.mockRejectedValue(new ldapService.LdapUnavailableError());

        await expect(authService.refresh('refresh', context)).rejects.toBeInstanceOf(Api503Error);
        expect(tokenRepository.deleteRefreshToken).not.toHaveBeenCalled();
    });
});
