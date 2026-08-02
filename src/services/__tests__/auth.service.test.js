'use strict';
jest.mock('../../repositories/user.repository');
jest.mock('../../repositories/token.repository');
jest.mock('../../repositories/social.repository');
jest.mock('../../utils/cryptoHelper.util');
jest.mock('../../utils/tokenManager.util');
jest.mock('../../utils/mailer.util');
jest.mock('../../utils/activityLogger.util', () => ({ logActivity: jest.fn() }));
jest.mock('../mfa.service');

const userRepository = require('../../repositories/user.repository');
const tokenRepository = require('../../repositories/token.repository');
const socialRepository = require('../../repositories/social.repository');
const cryptoHelper = require('../../utils/cryptoHelper.util');
const tokenManager = require('../../utils/tokenManager.util');
const mailer = require('../../utils/mailer.util');
const activityLogger = require('../../utils/activityLogger.util');
const mfaService = require('../mfa.service');
const authService = require('../auth.service');
const {
    Api400Error,
    Api401Error,
    Api403Error,
    Api404Error,
    Api409Error,
} = require('../../core/error.response');
const { PG_UNIQUE_VIOLATION } = require('../../core/pg-error-codes');

const context = { ipAddress: '127.0.0.1', userAgent: 'jest', lang: 'vi' };
const baseUser = {
    id: 1,
    email: 'user@campha.gov.vn',
    full_name: 'Người dùng',
    role: 'citizen',
    role_name_vi: 'Công dân',
    role_name_en: 'Citizen',
    password_hash: 'hashed',
    is_active: true,
    email_verified: true,
    locked_until: null,
    login_attempts: 0,
    token_version: 3,
    must_change_password: false,
};
const tokenPair = {
    accessToken: 'access.jwt',
    refreshToken: 'refresh.jwt',
    jti: 'jti-1',
    accessExpiresAt: new Date('2026-01-01T00:15:00Z'),
    refreshExpiresAt: new Date('2026-02-01T00:00:00Z'),
};

beforeEach(() => {
    jest.clearAllMocks();
    cryptoHelper.hashPassword.mockResolvedValue('new-hash');
    cryptoHelper.comparePassword.mockResolvedValue(true);
    cryptoHelper.hashToken.mockImplementation((v) => `hash:${v}`);
    cryptoHelper.generateRandomToken.mockReturnValue('raw-token');
    tokenManager.generateTokenPair.mockReturnValue(tokenPair);
    tokenRepository.saveRefreshToken.mockResolvedValue();
    tokenRepository.deleteRefreshToken.mockResolvedValue();
    tokenRepository.deleteAllUserTokens.mockResolvedValue();
    tokenRepository.addToBlacklist.mockResolvedValue();
    userRepository.updateLoginSuccess.mockResolvedValue();
    activityLogger.logActivity.mockResolvedValue();
    mfaService.beginLogin.mockResolvedValue(null);
    mfaService.isRequiredForRole.mockReturnValue(false);
    mailer.sendPasswordResetEmail.mockResolvedValue();
    mailer.sendVerificationEmail.mockResolvedValue();
});

describe('register', () => {
    test('từ chối email đã tồn tại', async () => {
        userRepository.findByEmail.mockResolvedValue(baseUser);
        await expect(
            authService.register(
                { email: baseUser.email, password: 'x', fullName: 'A', phone: null },
                context,
            ),
        ).rejects.toBeInstanceOf(Api409Error);
        expect(userRepository.create).not.toHaveBeenCalled();
    });

    test('yêu cầu xác minh email: gửi verification, không trả token', async () => {
        userRepository.findByEmail.mockResolvedValue(null);
        userRepository.create.mockResolvedValue({ ...baseUser, id: 9 });
        tokenRepository.invalidateUserEmailVerificationTokens.mockResolvedValue();
        tokenRepository.saveEmailVerificationToken.mockResolvedValue();
        const result = await authService.register(
            { email: 'new@campha.gov.vn', password: 'x', fullName: 'New', phone: null },
            context,
        );
        expect(result.requiresVerification).toBe(true);
        expect(result.accessToken).toBeUndefined();
        expect(mailer.sendVerificationEmail).toHaveBeenCalled();
        expect(activityLogger.logActivity).toHaveBeenCalled();
    });

    test('race condition unique violation lúc create → 409', async () => {
        userRepository.findByEmail.mockResolvedValue(null);
        userRepository.create.mockRejectedValue({ code: PG_UNIQUE_VIOLATION });
        await expect(
            authService.register({ email: 'x@x.com', password: 'x', fullName: 'X' }, context),
        ).rejects.toBeInstanceOf(Api409Error);
    });

    test('lỗi khác lúc create được ném nguyên vẹn', async () => {
        userRepository.findByEmail.mockResolvedValue(null);
        const dbError = new Error('db down');
        userRepository.create.mockRejectedValue(dbError);
        await expect(
            authService.register({ email: 'x@x.com', password: 'x', fullName: 'X' }, context),
        ).rejects.toBe(dbError);
    });

    test('REQUIRE_EMAIL_VERIFICATION=false: trả token ngay, không gửi verification', async () => {
        let isolatedAuthService, isolatedUserRepo, isolatedTokenRepo, isolatedTokenManager;
        await jest.isolateModulesAsync(async () => {
            process.env.REQUIRE_EMAIL_VERIFICATION = 'false';
            jest.doMock('../../repositories/user.repository');
            jest.doMock('../../repositories/token.repository');
            jest.doMock('../../utils/cryptoHelper.util');
            jest.doMock('../../utils/tokenManager.util');
            jest.doMock('../../utils/activityLogger.util', () => ({ logActivity: jest.fn() }));
            jest.doMock('../mfa.service');
            isolatedUserRepo = require('../../repositories/user.repository');
            isolatedTokenRepo = require('../../repositories/token.repository');
            isolatedTokenManager = require('../../utils/tokenManager.util');
            const isolatedCrypto = require('../../utils/cryptoHelper.util');
            isolatedCrypto.hashPassword.mockResolvedValue('hash');
            isolatedCrypto.hashToken.mockImplementation((v) => `hash:${v}`);
            isolatedUserRepo.findByEmail.mockResolvedValue(null);
            isolatedUserRepo.create.mockResolvedValue({ ...baseUser, id: 10 });
            isolatedUserRepo.updateLoginSuccess.mockResolvedValue();
            isolatedTokenRepo.saveRefreshToken.mockResolvedValue();
            isolatedTokenManager.generateTokenPair.mockReturnValue(tokenPair);
            isolatedAuthService = require('../auth.service');
        });
        delete process.env.REQUIRE_EMAIL_VERIFICATION;
        const result = await isolatedAuthService.register(
            { email: 'noverif@campha.gov.vn', password: 'x', fullName: 'X' },
            context,
        );
        expect(result.requiresVerification).toBe(false);
        expect(result.accessToken).toBe(tokenPair.accessToken);
        expect(isolatedUserRepo.updateLoginSuccess).toHaveBeenCalled();
        expect(isolatedTokenRepo.saveRefreshToken).toHaveBeenCalled();
    });
});

describe('login', () => {
    test('email không tồn tại vẫn chạy compare (chống timing attack) rồi 401', async () => {
        userRepository.findByEmail.mockResolvedValue(null);
        await expect(
            authService.login({ email: 'nope@x.com', password: 'x' }, context),
        ).rejects.toBeInstanceOf(Api401Error);
        expect(cryptoHelper.comparePassword).toHaveBeenCalled();
        expect(activityLogger.logActivity).toHaveBeenCalled();
    });

    test('tài khoản bị vô hiệu hóa → 401 trước khi kiểm tra mật khẩu', async () => {
        userRepository.findByEmail.mockResolvedValue({ ...baseUser, is_active: false });
        await expect(
            authService.login({ email: baseUser.email, password: 'x' }, context),
        ).rejects.toBeInstanceOf(Api401Error);
        expect(cryptoHelper.comparePassword).not.toHaveBeenCalled();
    });

    test('tài khoản đang khóa tạm → 401', async () => {
        userRepository.findByEmail.mockResolvedValue({
            ...baseUser,
            locked_until: new Date(Date.now() + 5 * 60 * 1000),
        });
        await expect(
            authService.login({ email: baseUser.email, password: 'x' }, context),
        ).rejects.toBeInstanceOf(Api401Error);
    });

    test('tài khoản chỉ đăng nhập Google (không có password_hash) → 401', async () => {
        userRepository.findByEmail.mockResolvedValue({ ...baseUser, password_hash: null });
        await expect(
            authService.login({ email: baseUser.email, password: 'x' }, context),
        ).rejects.toBeInstanceOf(Api401Error);
    });

    test('sai mật khẩu còn lượt thử → 401 kèm số lần còn lại', async () => {
        userRepository.findByEmail.mockResolvedValue(baseUser);
        cryptoHelper.comparePassword.mockResolvedValue(false);
        userRepository.incrementLoginAttempts.mockResolvedValue({ login_attempts: 2 });
        await expect(
            authService.login({ email: baseUser.email, password: 'wrong' }, context),
        ).rejects.toBeInstanceOf(Api401Error);
        expect(userRepository.incrementLoginAttempts).toHaveBeenCalledWith(baseUser.id, 5, 15);
    });

    test('sai mật khẩu đủ số lần → khóa tài khoản, log account_locked', async () => {
        userRepository.findByEmail.mockResolvedValue(baseUser);
        cryptoHelper.comparePassword.mockResolvedValue(false);
        userRepository.incrementLoginAttempts.mockResolvedValue({
            login_attempts: 5,
            locked_until: new Date(Date.now() + 15 * 60 * 1000),
        });
        await expect(
            authService.login({ email: baseUser.email, password: 'wrong' }, context),
        ).rejects.toBeInstanceOf(Api401Error);
        expect(activityLogger.logActivity).toHaveBeenCalledWith(
            '[AUTH]',
            expect.objectContaining({ action: 'account_locked' }),
        );
    });

    test('yêu cầu xác minh email nhưng chưa xác minh → 403', async () => {
        userRepository.findByEmail.mockResolvedValue({ ...baseUser, email_verified: false });
        await expect(
            authService.login({ email: baseUser.email, password: 'x' }, context),
        ).rejects.toBeInstanceOf(Api403Error);
    });

    test('đăng nhập thành công, không MFA → trả token và lưu refresh', async () => {
        userRepository.findByEmail.mockResolvedValue(baseUser);
        mfaService.beginLogin.mockResolvedValue(null);
        const result = await authService.login({ email: baseUser.email, password: 'x' }, context);
        expect(result.accessToken).toBe(tokenPair.accessToken);
        expect(result.mfaRequired).toBeUndefined();
        expect(tokenRepository.saveRefreshToken).toHaveBeenCalled();
        expect(userRepository.updateLoginSuccess).toHaveBeenCalledWith(
            baseUser.id,
            context.ipAddress,
        );
    });

    test('đăng nhập yêu cầu MFA → không phát token, trả challenge', async () => {
        userRepository.findByEmail.mockResolvedValue(baseUser);
        mfaService.beginLogin.mockResolvedValue({ mfaToken: 'chal', purpose: 'login' });
        const result = await authService.login({ email: baseUser.email, password: 'x' }, context);
        expect(result.mfaRequired).toBe(true);
        expect(result.accessToken).toBeUndefined();
        expect(tokenManager.generateTokenPair).not.toHaveBeenCalled();
        expect(tokenRepository.saveRefreshToken).not.toHaveBeenCalled();
    });
});

describe('refresh', () => {
    test('JWT không hợp lệ → 401', async () => {
        tokenManager.verifyRefreshToken.mockImplementation(() => {
            throw new Error('bad token');
        });
        await expect(authService.refresh('garbage', context)).rejects.toBeInstanceOf(Api401Error);
    });

    test('token hợp lệ nhưng không còn trong DB → thu hồi toàn bộ session (reuse detection)', async () => {
        tokenManager.verifyRefreshToken.mockReturnValue({ userId: 5, tokenVersion: 1 });
        tokenRepository.findRefreshToken.mockResolvedValue(null);
        userRepository.incrementTokenVersion.mockResolvedValue(2);
        await expect(authService.refresh('stolen', context)).rejects.toBeInstanceOf(Api401Error);
        expect(tokenRepository.deleteAllUserTokens).toHaveBeenCalledWith(5);
        expect(userRepository.incrementTokenVersion).toHaveBeenCalledWith(5);
        expect(activityLogger.logActivity).toHaveBeenCalledWith(
            '[AUTH]',
            expect.objectContaining({ action: 'token_reuse_detected' }),
        );
    });

    test('user vô hiệu hóa hoặc tokenVersion lệch → xóa token, 401', async () => {
        tokenManager.verifyRefreshToken.mockReturnValue({ userId: 5, tokenVersion: 1 });
        tokenRepository.findRefreshToken.mockResolvedValue({ device_info: {} });
        userRepository.findById.mockResolvedValue({ ...baseUser, id: 5, token_version: 2 });
        await expect(authService.refresh('valid-but-stale', context)).rejects.toBeInstanceOf(
            Api401Error,
        );
        expect(tokenRepository.deleteRefreshToken).toHaveBeenCalled();
    });

    test('refresh hợp lệ → xoay token, giữ device_info cũ nếu có', async () => {
        tokenManager.verifyRefreshToken.mockReturnValue({ userId: 5, tokenVersion: 3 });
        tokenRepository.findRefreshToken.mockResolvedValue({ device_info: { ip: 'old' } });
        userRepository.findById.mockResolvedValue({ ...baseUser, id: 5, token_version: 3 });
        const result = await authService.refresh('valid', context);
        expect(result.accessToken).toBe(tokenPair.accessToken);
        expect(tokenRepository.saveRefreshToken).toHaveBeenCalledWith(
            expect.objectContaining({ deviceInfo: { ip: 'old' } }),
        );
        expect(activityLogger.logActivity).toHaveBeenCalledWith(
            '[AUTH]',
            expect.objectContaining({ action: 'refresh_token' }),
        );
    });
});

describe('logout', () => {
    test('có jti và exp → blacklist theo exp thật', async () => {
        const exp = Math.floor(Date.now() / 1000) + 900;
        await authService.logout({ jti: 'j1', exp }, 'rt', 1, context);
        expect(tokenRepository.addToBlacklist).toHaveBeenCalledWith('j1', new Date(exp * 1000));
    });

    test('không có jti → không blacklist', async () => {
        await authService.logout({}, null, 1, context);
        expect(tokenRepository.addToBlacklist).not.toHaveBeenCalled();
    });

    test('có refreshToken → xóa theo hash', async () => {
        await authService.logout({}, 'rt', 1, context);
        expect(tokenRepository.deleteRefreshToken).toHaveBeenCalledWith('hash:rt');
    });

    test('luôn ghi log logout', async () => {
        await authService.logout({}, null, 1, context);
        expect(activityLogger.logActivity).toHaveBeenCalledWith(
            '[AUTH]',
            expect.objectContaining({ action: 'logout' }),
        );
    });
});

describe('changePassword', () => {
    test('user không tồn tại → 404', async () => {
        userRepository.findById.mockResolvedValue(null);
        await expect(
            authService.changePassword(1, { oldPassword: 'a', newPassword: 'b' }, context),
        ).rejects.toBeInstanceOf(Api404Error);
    });

    test('tài khoản Google chưa có mật khẩu → 400', async () => {
        userRepository.findById.mockResolvedValue({ ...baseUser, password_hash: null });
        await expect(
            authService.changePassword(1, { oldPassword: 'a', newPassword: 'b' }, context),
        ).rejects.toBeInstanceOf(Api400Error);
    });

    test('sai mật khẩu cũ → 401', async () => {
        userRepository.findById.mockResolvedValue(baseUser);
        cryptoHelper.comparePassword.mockResolvedValueOnce(false);
        await expect(
            authService.changePassword(1, { oldPassword: 'wrong', newPassword: 'b' }, context),
        ).rejects.toBeInstanceOf(Api401Error);
    });

    test('mật khẩu mới trùng mật khẩu cũ → 400', async () => {
        userRepository.findById.mockResolvedValue(baseUser);
        cryptoHelper.comparePassword.mockResolvedValueOnce(true).mockResolvedValueOnce(true);
        await expect(
            authService.changePassword(1, { oldPassword: 'a', newPassword: 'a' }, context),
        ).rejects.toBeInstanceOf(Api400Error);
    });

    test('đổi mật khẩu thành công → thu hồi toàn bộ session', async () => {
        userRepository.findById.mockResolvedValue(baseUser);
        cryptoHelper.comparePassword.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
        userRepository.updatePassword.mockResolvedValue();
        userRepository.incrementTokenVersion.mockResolvedValue();
        const result = await authService.changePassword(
            1,
            { oldPassword: 'a', newPassword: 'newone' },
            context,
        );
        expect(userRepository.updatePassword).toHaveBeenCalledWith(1, 'new-hash');
        expect(tokenRepository.deleteAllUserTokens).toHaveBeenCalledWith(1);
        expect(result.message).toBeTruthy();
    });
});

describe('setPassword', () => {
    test('user không tồn tại → 404', async () => {
        userRepository.findById.mockResolvedValue(null);
        await expect(
            authService.setPassword(1, { newPassword: 'x' }, context),
        ).rejects.toBeInstanceOf(Api404Error);
    });

    test('tài khoản bị vô hiệu hóa → 401', async () => {
        userRepository.findById.mockResolvedValue({ ...baseUser, is_active: false });
        await expect(
            authService.setPassword(1, { newPassword: 'x' }, context),
        ).rejects.toBeInstanceOf(Api401Error);
    });

    test('đã có mật khẩu → 400', async () => {
        userRepository.findById.mockResolvedValue(baseUser);
        await expect(
            authService.setPassword(1, { newPassword: 'x' }, context),
        ).rejects.toBeInstanceOf(Api400Error);
    });

    test('chưa liên kết social nào → không được tạo mật khẩu lần đầu', async () => {
        userRepository.findById.mockResolvedValue({ ...baseUser, password_hash: null });
        socialRepository.hasActiveProvider.mockResolvedValue(false);
        await expect(
            authService.setPassword(1, { newPassword: 'x' }, context),
        ).rejects.toBeInstanceOf(Api400Error);
    });

    test('tạo mật khẩu thành công cho tài khoản Google', async () => {
        userRepository.findById.mockResolvedValue({ ...baseUser, password_hash: null });
        socialRepository.hasActiveProvider.mockResolvedValue(true);
        userRepository.updatePassword.mockResolvedValue();
        const result = await authService.setPassword(1, { newPassword: 'x' }, context);
        expect(result.data.has_password).toBe(true);
        expect(tokenRepository.deleteAllUserTokens).toHaveBeenCalledWith(1);
    });
});

describe('forgotPassword', () => {
    test('email không tồn tại → thông điệp chung, không lộ thông tin', async () => {
        userRepository.findByEmail.mockResolvedValue(null);
        const result = await authService.forgotPassword({ email: 'nope@x.com' }, context);
        expect(result.message).toBeTruthy();
        expect(tokenRepository.savePasswordResetToken).not.toHaveBeenCalled();
    });

    test('tài khoản vô hiệu hóa → cùng thông điệp chung', async () => {
        userRepository.findByEmail.mockResolvedValue({ ...baseUser, is_active: false });
        const result = await authService.forgotPassword({ email: baseUser.email }, context);
        expect(result.message).toBeTruthy();
        expect(tokenRepository.savePasswordResetToken).not.toHaveBeenCalled();
    });

    test('tài khoản Google-only → cùng thông điệp chung', async () => {
        userRepository.findByEmail.mockResolvedValue({ ...baseUser, password_hash: null });
        const result = await authService.forgotPassword({ email: baseUser.email }, context);
        expect(result.message).toBeTruthy();
        expect(tokenRepository.savePasswordResetToken).not.toHaveBeenCalled();
    });

    test('vượt hạn mức yêu cầu reset trong cửa sổ thời gian → không gửi thêm', async () => {
        userRepository.findByEmail.mockResolvedValue(baseUser);
        tokenRepository.countRecentResetRequests.mockResolvedValue(3);
        const result = await authService.forgotPassword({ email: baseUser.email }, context);
        expect(result.message).toBeTruthy();
        expect(tokenRepository.savePasswordResetToken).not.toHaveBeenCalled();
    });

    test('thành công → tạo token, gửi email', async () => {
        userRepository.findByEmail.mockResolvedValue(baseUser);
        tokenRepository.countRecentResetRequests.mockResolvedValue(0);
        tokenRepository.invalidateUserResetTokens.mockResolvedValue();
        tokenRepository.savePasswordResetToken.mockResolvedValue();
        await authService.forgotPassword({ email: baseUser.email }, context);
        expect(tokenRepository.savePasswordResetToken).toHaveBeenCalled();
        expect(mailer.sendPasswordResetEmail).toHaveBeenCalled();
    });

    test('gửi email lỗi vẫn không làm fail request', async () => {
        userRepository.findByEmail.mockResolvedValue(baseUser);
        tokenRepository.countRecentResetRequests.mockResolvedValue(0);
        tokenRepository.invalidateUserResetTokens.mockResolvedValue();
        tokenRepository.savePasswordResetToken.mockResolvedValue();
        mailer.sendPasswordResetEmail.mockRejectedValue(new Error('smtp down'));
        const result = await authService.forgotPassword({ email: baseUser.email }, context);
        expect(result.message).toBeTruthy();
    });
});

describe('resetPassword', () => {
    test('token không hợp lệ hoặc hết hạn → 400', async () => {
        tokenRepository.findValidPasswordResetToken.mockResolvedValue(null);
        await expect(
            authService.resetPassword({ token: 'bad', newPassword: 'x' }, context),
        ).rejects.toBeInstanceOf(Api400Error);
    });

    test('user không tồn tại hoặc vô hiệu hóa → 400', async () => {
        tokenRepository.findValidPasswordResetToken.mockResolvedValue({ id: 1, user_id: 1 });
        userRepository.findById.mockResolvedValue(null);
        await expect(
            authService.resetPassword({ token: 'ok', newPassword: 'x' }, context),
        ).rejects.toBeInstanceOf(Api400Error);
    });

    test('mật khẩu mới trùng mật khẩu hiện tại → 400', async () => {
        tokenRepository.findValidPasswordResetToken.mockResolvedValue({ id: 1, user_id: 1 });
        userRepository.findById.mockResolvedValue(baseUser);
        cryptoHelper.comparePassword.mockResolvedValue(true);
        await expect(
            authService.resetPassword({ token: 'ok', newPassword: 'same' }, context),
        ).rejects.toBeInstanceOf(Api400Error);
    });

    test('đặt lại mật khẩu thành công → thu hồi toàn bộ session', async () => {
        tokenRepository.findValidPasswordResetToken.mockResolvedValue({ id: 1, user_id: 1 });
        userRepository.findById.mockResolvedValue(baseUser);
        cryptoHelper.comparePassword.mockResolvedValue(false);
        userRepository.updatePassword.mockResolvedValue();
        tokenRepository.markPasswordResetTokenUsed.mockResolvedValue();
        tokenRepository.invalidateUserResetTokens.mockResolvedValue();
        const result = await authService.resetPassword(
            { token: 'ok', newPassword: 'brandnew' },
            context,
        );
        expect(userRepository.updatePassword).toHaveBeenCalledWith(1, 'new-hash');
        expect(tokenRepository.deleteAllUserTokens).toHaveBeenCalledWith(1);
        expect(result.message).toBeTruthy();
    });
});

describe('verifyEmail', () => {
    test('token không hợp lệ → 400', async () => {
        tokenRepository.findValidEmailVerificationToken.mockResolvedValue(null);
        await expect(authService.verifyEmail({ token: 'bad' }, context)).rejects.toBeInstanceOf(
            Api400Error,
        );
    });

    test('user không tồn tại hoặc vô hiệu hóa → 400', async () => {
        tokenRepository.findValidEmailVerificationToken.mockResolvedValue({ id: 1, user_id: 1 });
        userRepository.findById.mockResolvedValue(null);
        await expect(authService.verifyEmail({ token: 'ok' }, context)).rejects.toBeInstanceOf(
            Api400Error,
        );
    });

    test('xác minh thành công', async () => {
        tokenRepository.findValidEmailVerificationToken.mockResolvedValue({ id: 1, user_id: 1 });
        userRepository.findById.mockResolvedValue(baseUser);
        userRepository.markEmailVerified.mockResolvedValue();
        tokenRepository.markEmailVerificationTokenUsed.mockResolvedValue();
        tokenRepository.invalidateUserEmailVerificationTokens.mockResolvedValue();
        const result = await authService.verifyEmail({ token: 'ok' }, context);
        expect(userRepository.markEmailVerified).toHaveBeenCalledWith(1);
        expect(result.message).toBeTruthy();
    });
});

describe('resendVerification', () => {
    test('user không tồn tại, vô hiệu hóa hoặc đã xác minh → không gửi lại', async () => {
        userRepository.findByEmail.mockResolvedValue(null);
        await authService.resendVerification({ email: 'x@x.com' }, context);
        expect(tokenRepository.saveEmailVerificationToken).not.toHaveBeenCalled();

        userRepository.findByEmail.mockResolvedValue({ ...baseUser, email_verified: true });
        await authService.resendVerification({ email: baseUser.email }, context);
        expect(tokenRepository.saveEmailVerificationToken).not.toHaveBeenCalled();
    });

    test('vượt hạn mức gửi lại → không gửi thêm', async () => {
        userRepository.findByEmail.mockResolvedValue({ ...baseUser, email_verified: false });
        tokenRepository.countRecentEmailVerificationRequests.mockResolvedValue(3);
        await authService.resendVerification({ email: baseUser.email }, context);
        expect(tokenRepository.saveEmailVerificationToken).not.toHaveBeenCalled();
    });

    test('gửi lại thành công', async () => {
        userRepository.findByEmail.mockResolvedValue({ ...baseUser, email_verified: false });
        tokenRepository.countRecentEmailVerificationRequests.mockResolvedValue(0);
        tokenRepository.invalidateUserEmailVerificationTokens.mockResolvedValue();
        tokenRepository.saveEmailVerificationToken.mockResolvedValue();
        await authService.resendVerification({ email: baseUser.email }, context);
        expect(tokenRepository.saveEmailVerificationToken).toHaveBeenCalled();
        expect(mailer.sendVerificationEmail).toHaveBeenCalled();
    });

    test('gửi email verification lỗi vẫn không làm fail request', async () => {
        userRepository.findByEmail.mockResolvedValue({ ...baseUser, email_verified: false });
        tokenRepository.countRecentEmailVerificationRequests.mockResolvedValue(0);
        tokenRepository.invalidateUserEmailVerificationTokens.mockResolvedValue();
        tokenRepository.saveEmailVerificationToken.mockResolvedValue();
        mailer.sendVerificationEmail.mockRejectedValue(new Error('smtp down'));
        const result = await authService.resendVerification({ email: baseUser.email }, context);
        expect(result.message).toBeTruthy();
    });
});

describe('googleAuthCallback', () => {
    const googleProfile = {
        googleId: 'g-1',
        email: 'g@campha.gov.vn',
        fullName: 'Google User',
        avatarUrl: 'https://x/avatar.png',
    };

    test('social link đã tồn tại → cập nhật, không tạo user mới', async () => {
        socialRepository.findByProviderId.mockResolvedValue({ user_id: 1 });
        userRepository.findById.mockResolvedValue(baseUser);
        socialRepository.updateByProviderId.mockResolvedValue();
        const result = await authService.googleAuthCallback(googleProfile, context);
        expect(userRepository.create).not.toHaveBeenCalled();
        expect(socialRepository.updateByProviderId).toHaveBeenCalled();
        expect(result.accessToken).toBe(tokenPair.accessToken);
    });

    test('chưa liên kết nhưng email trùng user hiện có → liên kết social', async () => {
        socialRepository.findByProviderId.mockResolvedValue(null);
        userRepository.findByEmail.mockResolvedValue({ ...baseUser, avatar_url: null });
        socialRepository.create.mockResolvedValue();
        userRepository.updateAvatar.mockResolvedValue();
        const result = await authService.googleAuthCallback(googleProfile, context);
        expect(socialRepository.create).toHaveBeenCalled();
        expect(userRepository.updateAvatar).toHaveBeenCalledWith(
            baseUser.id,
            googleProfile.avatarUrl,
        );
        expect(result.isNewUser).toBe(false);
    });

    test('không tìm thấy email nào → tạo user mới role citizen, đã xác minh', async () => {
        socialRepository.findByProviderId.mockResolvedValue(null);
        userRepository.findByEmail.mockResolvedValue(null);
        userRepository.create.mockResolvedValue({ ...baseUser, id: 55 });
        socialRepository.create.mockResolvedValue();
        const result = await authService.googleAuthCallback(googleProfile, context);
        expect(userRepository.create).toHaveBeenCalledWith(
            expect.objectContaining({ roleCode: 'citizen', emailVerified: true }),
        );
        expect(result.isNewUser).toBe(true);
    });

    test('user không active sau khi resolve → 401', async () => {
        socialRepository.findByProviderId.mockResolvedValue({ user_id: 1 });
        userRepository.findById.mockResolvedValue({ ...baseUser, is_active: false });
        await expect(authService.googleAuthCallback(googleProfile, context)).rejects.toBeInstanceOf(
            Api401Error,
        );
    });

    test('yêu cầu MFA cho role → trả challenge, không phát token', async () => {
        socialRepository.findByProviderId.mockResolvedValue({ user_id: 1 });
        userRepository.findById.mockResolvedValue(baseUser);
        mfaService.beginLogin.mockResolvedValue({ mfaToken: 'chal' });
        mfaService.isRequiredForRole.mockReturnValue(true);
        const result = await authService.googleAuthCallback(googleProfile, context);
        expect(result.mfaRequired).toBe(true);
        expect(result.accessToken).toBeUndefined();
    });

    test('user tồn tại nhưng chưa xác minh email → tự động đánh dấu đã xác minh', async () => {
        socialRepository.findByProviderId.mockResolvedValue({ user_id: 1 });
        userRepository.findById.mockResolvedValue({ ...baseUser, email_verified: false });
        userRepository.markEmailVerified.mockResolvedValue();
        const result = await authService.googleAuthCallback(googleProfile, context);
        expect(userRepository.markEmailVerified).toHaveBeenCalledWith(baseUser.id);
        expect(result.accessToken).toBe(tokenPair.accessToken);
    });
});

describe('OAuth exchange code', () => {
    test('createOAuthExchangeCode lưu theo hash, trả mã thô', async () => {
        tokenRepository.saveOAuthExchangeCode.mockResolvedValue();
        const code = await authService.createOAuthExchangeCode({
            user: { id: 1 },
            accessToken: 'a',
            refreshToken: 'r',
            isNewUser: false,
        });
        expect(code).toBe('raw-token');
        expect(tokenRepository.saveOAuthExchangeCode).toHaveBeenCalledWith(
            expect.objectContaining({ codeHash: 'hash:raw-token' }),
        );
    });

    test('mã không hợp lệ hoặc đã dùng → 400', async () => {
        tokenRepository.consumeOAuthExchangeCode.mockResolvedValue(null);
        await expect(authService.exchangeOAuthCode({ code: 'x' }, context)).rejects.toBeInstanceOf(
            Api400Error,
        );
    });

    test('bản ghi yêu cầu MFA nhưng user không còn hợp lệ → 401', async () => {
        tokenRepository.consumeOAuthExchangeCode.mockResolvedValue({
            mfa_required: true,
            user_id: 1,
        });
        userRepository.findById.mockResolvedValue(null);
        await expect(authService.exchangeOAuthCode({ code: 'x' }, context)).rejects.toBeInstanceOf(
            Api401Error,
        );
    });

    test('bản ghi yêu cầu MFA và user hợp lệ → trả challenge MFA', async () => {
        tokenRepository.consumeOAuthExchangeCode.mockResolvedValue({
            mfa_required: true,
            user_id: 1,
            is_new_user: false,
        });
        userRepository.findById.mockResolvedValue(baseUser);
        mfaService.isRequiredForRole.mockReturnValue(true);
        mfaService.beginLogin.mockResolvedValue({ mfaToken: 'chal', purpose: 'login' });
        const result = await authService.exchangeOAuthCode({ code: 'x' }, context);
        expect(result.mfaRequired).toBe(true);
        expect(result.mfaToken).toBe('chal');
    });

    test('bản ghi thường → trả thẳng token đã lưu', async () => {
        tokenRepository.consumeOAuthExchangeCode.mockResolvedValue({
            mfa_required: false,
            access_token: 'a',
            refresh_token: 'r',
            is_new_user: true,
        });
        const result = await authService.exchangeOAuthCode({ code: 'x' }, context);
        expect(result).toEqual({ accessToken: 'a', refreshToken: 'r', isNewUser: true });
    });
});

describe('getMe / updateMe', () => {
    test('getMe: không tồn tại → 404', async () => {
        userRepository.findByIdSafe.mockResolvedValue(null);
        await expect(authService.getMe(1, context)).rejects.toBeInstanceOf(Api404Error);
    });

    test('getMe: trả DTO an toàn', async () => {
        userRepository.findByIdSafe.mockResolvedValue(baseUser);
        const result = await authService.getMe(1, context);
        expect(result).not.toHaveProperty('password_hash');
    });

    test('updateMe: user không tồn tại → 404', async () => {
        userRepository.findById.mockResolvedValue(null);
        await expect(authService.updateMe(1, {}, null, context)).rejects.toBeInstanceOf(
            Api404Error,
        );
    });

    test('updateMe: cập nhật thất bại kèm expectedUpdatedAt → 409 (optimistic lock)', async () => {
        userRepository.findById.mockResolvedValue(baseUser);
        userRepository.updateProfile.mockResolvedValue(null);
        await expect(
            authService.updateMe(1, { expectedUpdatedAt: '2026-01-01' }, null, context),
        ).rejects.toBeInstanceOf(Api409Error);
    });

    test('updateMe: cập nhật thất bại không kèm version → 404', async () => {
        userRepository.findById.mockResolvedValue(baseUser);
        userRepository.updateProfile.mockResolvedValue(null);
        await expect(authService.updateMe(1, {}, null, context)).rejects.toBeInstanceOf(
            Api404Error,
        );
    });

    test('updateMe: có file upload → dùng đường dẫn file làm avatar', async () => {
        userRepository.findById.mockResolvedValue(baseUser);
        userRepository.updateProfile.mockResolvedValue(baseUser);
        const file = { _relativeDir: 'avatars', filename: 'a.png' };
        await authService.updateMe(1, {}, file, context);
        expect(userRepository.updateProfile).toHaveBeenCalledWith(
            1,
            expect.objectContaining({ avatarUrl: 'avatars/a.png' }),
        );
    });

    test('updateMe: phone rỗng được chuẩn hóa thành null', async () => {
        userRepository.findById.mockResolvedValue(baseUser);
        userRepository.updateProfile.mockResolvedValue(baseUser);
        await authService.updateMe(1, { phone: '' }, null, context);
        expect(userRepository.updateProfile).toHaveBeenCalledWith(
            1,
            expect.objectContaining({ phone: null }),
        );
    });
});

describe('googleMobileLogin', () => {
    const validPayload = {
        aud: 'client-id-1',
        iss: 'accounts.google.com',
        exp: Math.floor(Date.now() / 1000) + 3600,
        email: 'mobile@campha.gov.vn',
        email_verified: true,
        sub: 'g-mobile-1',
        name: 'Mobile User',
        picture: 'https://x/p.png',
    };

    beforeEach(() => {
        process.env.GOOGLE_CLIENT_ID = 'client-id-1';
        global.fetch = jest.fn();
    });
    afterEach(() => {
        delete process.env.GOOGLE_CLIENT_ID;
        delete global.fetch;
    });

    test('fetch thất bại (network) → 401', async () => {
        global.fetch.mockRejectedValue(new Error('network down'));
        await expect(
            authService.googleMobileLogin({ idToken: 't' }, context),
        ).rejects.toBeInstanceOf(Api401Error);
    });

    test('Google trả response không ok → 401', async () => {
        global.fetch.mockResolvedValue({ ok: false });
        await expect(
            authService.googleMobileLogin({ idToken: 't' }, context),
        ).rejects.toBeInstanceOf(Api401Error);
    });

    test('audience không khớp → 401', async () => {
        global.fetch.mockResolvedValue({
            ok: true,
            json: async () => ({ ...validPayload, aud: 'someone-else' }),
        });
        await expect(
            authService.googleMobileLogin({ idToken: 't' }, context),
        ).rejects.toBeInstanceOf(Api401Error);
    });

    test('issuer không hợp lệ → 401', async () => {
        global.fetch.mockResolvedValue({
            ok: true,
            json: async () => ({ ...validPayload, iss: 'evil.example.com' }),
        });
        await expect(
            authService.googleMobileLogin({ idToken: 't' }, context),
        ).rejects.toBeInstanceOf(Api401Error);
    });

    test('token đã hết hạn → 401', async () => {
        global.fetch.mockResolvedValue({
            ok: true,
            json: async () => ({ ...validPayload, exp: Math.floor(Date.now() / 1000) - 10 }),
        });
        await expect(
            authService.googleMobileLogin({ idToken: 't' }, context),
        ).rejects.toBeInstanceOf(Api401Error);
    });

    test('email chưa xác minh phía Google → 401', async () => {
        global.fetch.mockResolvedValue({
            ok: true,
            json: async () => ({ ...validPayload, email_verified: false }),
        });
        await expect(
            authService.googleMobileLogin({ idToken: 't' }, context),
        ).rejects.toBeInstanceOf(Api401Error);
    });

    test('payload hợp lệ → ủy quyền cho googleAuthCallback, tạo user mới', async () => {
        global.fetch.mockResolvedValue({ ok: true, json: async () => validPayload });
        socialRepository.findByProviderId.mockResolvedValue(null);
        userRepository.findByEmail.mockResolvedValue(null);
        userRepository.create.mockResolvedValue({ ...baseUser, id: 77, email: validPayload.email });
        socialRepository.create.mockResolvedValue();
        const result = await authService.googleMobileLogin({ idToken: 't' }, context);
        expect(result.isNewUser).toBe(true);
        expect(result.accessToken).toBe(tokenPair.accessToken);
    });
});

describe('invalidateSessions', () => {
    test('ủy quyền tăng token_version cho repository', async () => {
        userRepository.incrementTokenVersion.mockResolvedValue(4);
        const result = await authService.invalidateSessions(9);
        expect(userRepository.incrementTokenVersion).toHaveBeenCalledWith(9);
        expect(result).toBe(4);
    });
});
