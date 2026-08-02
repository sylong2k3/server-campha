process.env.MFA_ENABLED = 'true';

jest.mock('../../repositories/mfa.repository', () => ({
    findCredential: jest.fn(),
    upsertCredential: jest.fn(),
    completeEnrollment: jest.fn(),
    completeLogin: jest.fn(),
    createChallenge: jest.fn(),
    findChallenge: jest.fn(),
}));

jest.mock('../../repositories/user.repository', () => ({
    findById: jest.fn(),
    updateLoginSuccess: jest.fn(),
}));

jest.mock('../../utils/tokenManager.util', () => ({
    generateTokenPair: jest.fn(),
}));

jest.mock('../../utils/cryptoHelper.util', () => ({
    generateRandomToken: jest.fn(),
    hashToken: jest.fn((value) => `hash:${value}`),
}));

jest.mock('../../utils/totp.util', () => ({
    createSecret: jest.fn(),
    buildOtpAuthUri: jest.fn(),
    encryptSecret: jest.fn(),
    decryptSecret: jest.fn(),
    verifyTotp: jest.fn(),
}));

jest.mock('../../utils/activityLogger.util', () => ({
    logActivity: jest.fn(),
}));

const mfaRepository = require('../../repositories/mfa.repository');
const userRepository = require('../../repositories/user.repository');
const tokenManager = require('../../utils/tokenManager.util');
const cryptoHelper = require('../../utils/cryptoHelper.util');
const totp = require('../../utils/totp.util');
const mfaService = require('../mfa.service');

const user = {
    id: 7,
    email: 'tnmt@campha.gov.vn',
    full_name: 'Sở TNMT',
    role: 'so_tnmt',
    role_name_vi: 'Sở TNMT',
    role_name_en: 'DONRE',
    org_id: 2,
    org_code: 'so_tnmt_qn',
    org_name_vi: 'Sở TNMT Quảng Ninh',
    is_active: true,
    token_version: 3,
};

const context = { ipAddress: '127.0.0.1', userAgent: 'jest', lang: 'vi' };

describe('MFA service', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        cryptoHelper.generateRandomToken.mockReturnValue(
            'opaque-challenge-token-with-sufficient-entropy',
        );
        tokenManager.generateTokenPair.mockReturnValue({
            accessToken: 'access-token',
            refreshToken: 'refresh-token',
            refreshExpiresAt: new Date('2030-01-01T00:00:00Z'),
        });
        userRepository.findById.mockResolvedValue(user);
    });

    test('chỉ bắt buộc MFA cho TNMT và system admin khi feature được bật', () => {
        expect(mfaService.isRequiredForRole('so_tnmt')).toBe(true);
        expect(mfaService.isRequiredForRole('system_admin')).toBe(true);
        expect(mfaService.isRequiredForRole('citizen')).toBe(false);
    });

    test('MFA tắt thì mọi role đăng nhập không tạo challenge', async () => {
        process.env.MFA_ENABLED = 'false';
        try {
            expect(mfaService.isRequiredForRole('so_tnmt')).toBe(false);
            await expect(mfaService.beginLogin(user)).resolves.toBeNull();
            expect(mfaRepository.createChallenge).not.toHaveBeenCalled();
        } finally {
            process.env.MFA_ENABLED = 'true';
        }
    });

    test('role thường không tạo challenge', async () => {
        await expect(mfaService.beginLogin({ ...user, role: 'citizen' })).resolves.toBeNull();
        expect(mfaRepository.createChallenge).not.toHaveBeenCalled();
    });

    test('privileged user chưa enrollment nhận setup challenge đã hash', async () => {
        mfaRepository.findCredential.mockResolvedValue(null);
        const result = await mfaService.beginLogin(user);
        expect(result).toMatchObject({
            challengeToken: 'opaque-challenge-token-with-sufficient-entropy',
            purpose: 'setup',
        });
        expect(mfaRepository.createChallenge).toHaveBeenCalledWith(
            expect.objectContaining({
                userId: 7,
                tokenHash: 'hash:opaque-challenge-token-with-sufficient-entropy',
                purpose: 'setup',
            }),
        );
    });

    test('setup chỉ trả secret sau challenge hợp lệ', async () => {
        mfaRepository.findChallenge.mockResolvedValue({
            id: 1,
            user_id: 7,
            expires_at: new Date('2030-01-01T00:00:00Z'),
        });
        totp.createSecret.mockReturnValue('BASE32SECRET');
        totp.encryptSecret.mockReturnValue({ ciphertext: 'cipher', iv: 'iv', authTag: 'tag' });
        totp.buildOtpAuthUri.mockReturnValue('otpauth://totp/CamPha');

        await expect(mfaService.setup('challenge', context)).resolves.toMatchObject({
            secret: 'BASE32SECRET',
            otpAuthUri: 'otpauth://totp/CamPha',
        });
        expect(mfaRepository.upsertCredential).toHaveBeenCalledWith(7, {
            ciphertext: 'cipher',
            iv: 'iv',
            authTag: 'tag',
        });
    });

    test('confirm enrollment cấp 10 recovery codes và token sau TOTP hợp lệ', async () => {
        mfaRepository.findChallenge.mockResolvedValue({ id: 1, user_id: 7 });
        mfaRepository.findCredential.mockResolvedValue({
            is_enabled: false,
            secret_ciphertext: 'cipher',
            secret_iv: 'iv',
            secret_auth_tag: 'tag',
        });
        totp.decryptSecret.mockReturnValue('BASE32SECRET');
        totp.verifyTotp.mockReturnValue(100);
        mfaRepository.completeEnrollment.mockResolvedValue('ok');

        const result = await mfaService.confirm(
            { challengeToken: 'challenge', code: '123456' },
            context,
        );
        expect(result.recoveryCodes).toHaveLength(10);
        expect(mfaRepository.completeEnrollment).toHaveBeenCalledWith(
            expect.objectContaining({
                challengeId: 1,
                userId: 7,
                counter: 100,
                recoveryCodeHashes: expect.arrayContaining([
                    'hash:OPAQUE-CHALLENGE-TOKEN-WITH-SUFFICIENT-ENTROPY',
                ]),
                tokenVersion: 3,
                session: expect.objectContaining({ tokenHash: 'hash:refresh-token' }),
            }),
        );
        expect(tokenManager.generateTokenPair).toHaveBeenCalledWith(
            expect.objectContaining({
                userId: 7,
                tokenVersion: 3,
            }),
        );
    });

    test('TOTP counter đã dùng bị từ chối để chống replay', async () => {
        mfaRepository.findChallenge.mockResolvedValue({ id: 2, user_id: 7 });
        mfaRepository.findCredential.mockResolvedValue({
            is_enabled: true,
            secret_ciphertext: 'cipher',
            secret_iv: 'iv',
            secret_auth_tag: 'tag',
        });
        totp.decryptSecret.mockReturnValue('BASE32SECRET');
        totp.verifyTotp.mockReturnValue(100);
        mfaRepository.completeLogin.mockResolvedValue('code_invalid');

        await expect(
            mfaService.verify({ challengeToken: 'challenge', code: '123456' }, context),
        ).rejects.toMatchObject({ status: 401 });
    });

    test('recovery code được consume trước khi cấp token', async () => {
        mfaRepository.findChallenge.mockResolvedValue({ id: 3, user_id: 7 });
        mfaRepository.findCredential.mockResolvedValue({ is_enabled: true });
        mfaRepository.completeLogin.mockResolvedValue('ok');

        const result = await mfaService.verify(
            {
                challengeToken: 'challenge',
                recoveryCode: 'RECOVERYCODE',
            },
            context,
        );
        expect(mfaRepository.completeLogin).toHaveBeenCalledWith(
            expect.objectContaining({
                userId: 7,
                recoveryCodeHash: 'hash:RECOVERYCODE',
                session: expect.objectContaining({ tokenHash: 'hash:refresh-token' }),
            }),
        );
        expect(result.accessToken).toBe('access-token');
    });
    test.each([
        [
            'setup challenge hết hạn',
            async () => {
                mfaRepository.findChallenge.mockResolvedValue(null);
                return mfaService.setup('expired', context);
            },
            401,
        ],
        [
            'setup user không còn active',
            async () => {
                mfaRepository.findChallenge.mockResolvedValue({ user_id: 7 });
                userRepository.findById.mockResolvedValue({ ...user, is_active: false });
                return mfaService.setup('challenge', context);
            },
            401,
        ],
        [
            'confirm challenge hết hạn',
            async () => {
                mfaRepository.findChallenge.mockResolvedValue(null);
                return mfaService.confirm({ challengeToken: 'expired', code: '123456' }, context);
            },
            401,
        ],
        [
            'confirm credential đã enabled',
            async () => {
                mfaRepository.findChallenge.mockResolvedValue({ user_id: 7 });
                mfaRepository.findCredential.mockResolvedValue({ is_enabled: true });
                return mfaService.confirm({ challengeToken: 'challenge', code: '123456' }, context);
            },
            409,
        ],
        [
            'confirm sai TOTP',
            async () => {
                mfaRepository.findChallenge.mockResolvedValue({ user_id: 7 });
                mfaRepository.findCredential.mockResolvedValue({
                    is_enabled: false,
                    secret_ciphertext: 'cipher',
                    secret_iv: 'iv',
                    secret_auth_tag: 'tag',
                });
                totp.verifyTotp.mockReturnValue(null);
                return mfaService.confirm({ challengeToken: 'challenge', code: '000000' }, context);
            },
            401,
        ],
        [
            'confirm challenge consume race',
            async () => {
                mfaRepository.findChallenge.mockResolvedValue({ id: 1, user_id: 7 });
                mfaRepository.findCredential.mockResolvedValue({
                    is_enabled: false,
                    secret_ciphertext: 'cipher',
                    secret_iv: 'iv',
                    secret_auth_tag: 'tag',
                });
                totp.verifyTotp.mockReturnValue(100);
                mfaRepository.completeEnrollment.mockResolvedValue('challenge_invalid');
                return mfaService.confirm({ challengeToken: 'challenge', code: '123456' }, context);
            },
            401,
        ],
        [
            'confirm enable race',
            async () => {
                mfaRepository.findChallenge.mockResolvedValue({ id: 1, user_id: 7 });
                mfaRepository.findCredential.mockResolvedValue({
                    is_enabled: false,
                    secret_ciphertext: 'cipher',
                    secret_iv: 'iv',
                    secret_auth_tag: 'tag',
                });
                totp.verifyTotp.mockReturnValue(100);
                mfaRepository.completeEnrollment.mockResolvedValue('already_enabled');
                return mfaService.confirm({ challengeToken: 'challenge', code: '123456' }, context);
            },
            409,
        ],
        [
            'verify thiếu code',
            async () => mfaService.verify({ challengeToken: 'challenge' }, context),
            400,
        ],
        [
            'verify gửi hai code',
            async () =>
                mfaService.verify(
                    {
                        challengeToken: 'challenge',
                        code: '123456',
                        recoveryCode: 'RECOVERYCODE',
                    },
                    context,
                ),
            400,
        ],
        [
            'verify challenge hết hạn',
            async () => {
                mfaRepository.findChallenge.mockResolvedValue(null);
                return mfaService.verify({ challengeToken: 'expired', code: '123456' }, context);
            },
            401,
        ],
        [
            'verify MFA chưa enabled',
            async () => {
                mfaRepository.findChallenge.mockResolvedValue({ user_id: 7 });
                mfaRepository.findCredential.mockResolvedValue({ is_enabled: false });
                return mfaService.verify({ challengeToken: 'challenge', code: '123456' }, context);
            },
            401,
        ],
        [
            'verify recovery đã dùng',
            async () => {
                mfaRepository.findChallenge.mockResolvedValue({ user_id: 7 });
                mfaRepository.findCredential.mockResolvedValue({ is_enabled: true });
                mfaRepository.completeLogin.mockResolvedValue('code_invalid');
                return mfaService.verify(
                    { challengeToken: 'challenge', recoveryCode: 'RECOVERYCODE' },
                    context,
                );
            },
            401,
        ],
        [
            'verify challenge consume race',
            async () => {
                mfaRepository.findChallenge.mockResolvedValue({ id: 3, user_id: 7 });
                mfaRepository.findCredential.mockResolvedValue({ is_enabled: true });
                mfaRepository.completeLogin.mockResolvedValue('challenge_invalid');
                return mfaService.verify(
                    { challengeToken: 'challenge', recoveryCode: 'RECOVERYCODE' },
                    context,
                );
            },
            401,
        ],
        [
            'verify user đổi role',
            async () => {
                mfaRepository.findChallenge.mockResolvedValue({ id: 3, user_id: 7 });
                mfaRepository.findCredential.mockResolvedValue({ is_enabled: true });
                userRepository.findById.mockResolvedValue({ ...user, role: 'citizen' });
                return mfaService.verify(
                    { challengeToken: 'challenge', recoveryCode: 'RECOVERYCODE' },
                    context,
                );
            },
            401,
        ],
    ])('%s', async (_name, run, status) => {
        await expect(run()).rejects.toMatchObject({ status });
    });
});
