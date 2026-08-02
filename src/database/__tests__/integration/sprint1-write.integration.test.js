process.env.REQUIRE_EMAIL_VERIFICATION = 'true';
process.env.MFA_ENABLED = 'true';

if (process.env.DB_NAME !== 'campha_test') {
    throw new Error(
        `Write integration chỉ được chạy với DB_NAME=campha_test; received ${process.env.DB_NAME}`,
    );
}

jest.mock('../../../utils/mailer.util', () => ({
    sendPasswordResetEmail: jest.fn(),
    sendVerificationEmail: jest.fn(),
}));

const db = require('../../../configs/database');
const userRepository = require('../../../repositories/user.repository');
const authService = require('../../../services/auth.service');
const userService = require('../../../services/user.service');
const mfaService = require('../../../services/mfa.service');
const { hashPassword, hashToken } = require('../../../utils/cryptoHelper.util');
const { generateTotp } = require('../../../utils/totp.util');
const { verifyAccessToken } = require('../../../utils/tokenManager.util');

const PREFIX = 'it.sprint1.';
const PASSWORD = 'CamPha@2026';
const context = { ipAddress: '127.0.0.1', userAgent: 'jest-integration', lang: 'vi' };

const createUser = async ({
    email,
    roleCode = 'citizen',
    orgCode = 'ubnd_campha',
    emailVerified = true,
}) => {
    const passwordHash = await hashPassword(PASSWORD);
    const {
        rows: [org],
    } = await db.query('SELECT id FROM auth.organizations WHERE code = $1', [orgCode]);
    if (!org) {
        throw new Error(`Organization fixture missing: ${orgCode}`);
    }
    return userRepository.create({
        email,
        passwordHash,
        fullName: `Integration ${roleCode}`,
        roleCode,
        orgId: org.id,
        emailVerified,
    });
};

const cleanup = async () => {
    await db.query(
        `
        DELETE FROM auth.activity_logs
        WHERE user_id IN (SELECT id FROM auth.users WHERE email LIKE $1)
    `,
        [`${PREFIX}%`],
    );
    await db.query('DELETE FROM auth.users WHERE email LIKE $1', [`${PREFIX}%`]);
};

describe('Sprint 1 write integration', () => {
    beforeAll(async () => {
        await cleanup();
    });

    afterAll(async () => {
        await cleanup();
        db.stopPoolMonitor();
        await db.pool.end();
    });

    test('register giữ email unverified; verify token một lần rồi login/rotate/replay thu hồi mọi session', async () => {
        const email = `${PREFIX}auth@campha.test`;
        const registered = await authService.register(
            {
                email,
                password: PASSWORD,
                fullName: 'Integration Auth',
                phone: '',
            },
            context,
        );
        expect(registered.requiresVerification).toBe(true);

        let user = await userRepository.findByEmail(email);
        expect(user.email_verified).toBe(false);
        const {
            rows: [verification],
        } = await db.query(
            `
            SELECT id, token_hash FROM auth.email_verification_tokens
            WHERE user_id = $1 AND used_at IS NULL
        `,
            [user.id],
        );
        expect(verification.token_hash).toHaveLength(64);

        const rawToken = 'integration-email-verification-token';
        await db.query('UPDATE auth.email_verification_tokens SET token_hash = $2 WHERE id = $1', [
            verification.id,
            hashToken(rawToken),
        ]);
        await authService.verifyEmail({ token: rawToken }, context);
        await expect(authService.verifyEmail({ token: rawToken }, context)).rejects.toMatchObject({
            status: 400,
        });

        user = await userRepository.findByEmail(email);
        expect(user.email_verified).toBe(true);
        const login = await authService.login({ email, password: PASSWORD }, context);
        const rotated = await authService.refresh(login.refreshToken, context);
        expect(rotated.refreshToken).not.toBe(login.refreshToken);

        await expect(authService.refresh(login.refreshToken, context)).rejects.toMatchObject({
            status: 401,
        });
        const invalidated = await userRepository.findById(user.id);
        expect(invalidated.token_version).toBe(user.token_version + 1);
        const {
            rows: [sessions],
        } = await db.query(
            'SELECT COUNT(*)::int AS count FROM auth.refresh_tokens WHERE user_id = $1',
            [user.id],
        );
        expect(sessions.count).toBe(0);
    });

    test('cross-org list/get/change-role bị giới hạn bởi organization', async () => {
        const actorUser = await createUser({
            email: `${PREFIX}actor@campha.test`,
            roleCode: 'so_tnmt',
            orgCode: 'so_tnmt_qn',
        });
        const sameOrg = await createUser({
            email: `${PREFIX}same@campha.test`,
            orgCode: 'so_tnmt_qn',
        });
        const otherOrg = await createUser({
            email: `${PREFIX}other@campha.test`,
            orgCode: 'so_xd_qn',
        });
        const actor = {
            id: actorUser.id,
            role: actorUser.role,
            orgId: actorUser.org_id,
            permissions: actorUser.role_permissions,
            lang: 'vi',
            ipAddress: context.ipAddress,
            userAgent: context.userAgent,
        };

        const page = await userService.listUsers({ page: 1, limit: 100 }, actor);
        expect(page.items.map((item) => item.id)).toContain(sameOrg.id);
        expect(page.items.map((item) => item.id)).not.toContain(otherOrg.id);
        await expect(userService.getUserById(otherOrg.id, actor)).rejects.toMatchObject({
            status: 403,
        });
        await expect(userService.changeUserRole(otherOrg.id, 'so_xd', actor)).rejects.toMatchObject(
            { status: 403 },
        );
        expect((await userRepository.findById(otherOrg.id)).role).toBe('citizen');
    });

    test('admin tạo local user đúng organization và reset password thu hồi session', async () => {
        const actorUser = await createUser({
            email: `${PREFIX}local.actor@campha.test`,
            roleCode: 'so_tnmt',
            orgCode: 'so_tnmt_qn',
        });
        const actor = {
            id: actorUser.id,
            role: actorUser.role,
            orgId: actorUser.org_id,
            permissions: actorUser.role_permissions,
            lang: 'vi',
            ipAddress: context.ipAddress,
            userAgent: context.userAgent,
        };
        const email = `${PREFIX}local@campha.test`;
        const created = await userService.createUser(
            {
                email,
                password: PASSWORD,
                fullName: 'Integration Local',
                roleCode: 'so_xd',
            },
            actor,
        );
        expect(created).toMatchObject({ email, role: 'so_xd', org_id: actor.orgId });
        expect((await userRepository.findById(created.id)).password_hash).toBeTruthy();

        const login = await authService.login({ email, password: PASSWORD }, context);
        expect(login.refreshToken).toBeTruthy();
        await userService.resetUserPassword(created.id, 'NewCamPha@2026', actor);
        const {
            rows: [sessions],
        } = await db.query(
            'SELECT COUNT(*)::int AS count FROM auth.refresh_tokens WHERE user_id = $1',
            [created.id],
        );
        expect(sessions.count).toBe(0);
        await expect(authService.refresh(login.refreshToken, context)).rejects.toMatchObject({
            status: 401,
        });
    });

    test('MFA enrollment/login/recovery atomic; TOTP và recovery code không dùng lại', async () => {
        const user = await createUser({
            email: `${PREFIX}mfa@campha.test`,
            roleCode: 'so_tnmt',
            orgCode: 'so_tnmt_qn',
        });
        const setupLogin = await authService.login(
            { email: user.email, password: PASSWORD },
            context,
        );
        expect(setupLogin).toMatchObject({ mfaRequired: true, purpose: 'setup' });

        const setup = await mfaService.setup(setupLogin.challengeToken, context);
        const firstCode = generateTotp(setup.secret);
        const enrollment = await mfaService.confirm(
            {
                challengeToken: setupLogin.challengeToken,
                code: firstCode,
            },
            context,
        );
        expect(enrollment.recoveryCodes).toHaveLength(10);
        expect(verifyAccessToken(enrollment.accessToken).tokenVersion).toBe(user.token_version);
        await expect(
            mfaService.confirm(
                { challengeToken: setupLogin.challengeToken, code: firstCode },
                context,
            ),
        ).rejects.toMatchObject({ status: 401 });

        const recoveryLogin = await authService.login(
            { email: user.email, password: PASSWORD },
            context,
        );
        expect(recoveryLogin.purpose).toBe('login');
        const recoveryCode = enrollment.recoveryCodes[0];
        const recovered = await mfaService.verify(
            {
                challengeToken: recoveryLogin.challengeToken,
                recoveryCode,
            },
            context,
        );
        expect(recovered.accessToken).toBeTruthy();

        const reusedRecoveryLogin = await authService.login(
            { email: user.email, password: PASSWORD },
            context,
        );
        await expect(
            mfaService.verify(
                {
                    challengeToken: reusedRecoveryLogin.challengeToken,
                    recoveryCode,
                },
                context,
            ),
        ).rejects.toMatchObject({ status: 401 });
    });
});
