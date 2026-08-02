jest.mock('../../repositories/user.repository');
jest.mock('../../repositories/token.repository');
jest.mock('../../utils/cryptoHelper.util');
jest.mock('../../utils/activityLogger.util', () => ({ logActivity: jest.fn() }));

const userRepository = require('../../repositories/user.repository');
const tokenRepository = require('../../repositories/token.repository');
const cryptoHelper = require('../../utils/cryptoHelper.util');
const activityLogger = require('../../utils/activityLogger.util');
const userService = require('../user.service');
const { Api400Error, Api403Error, Api404Error, Api409Error } = require('../../core/error.response');
const { PG_UNIQUE_VIOLATION } = require('../../core/pg-error-codes');

const actor = {
    id: 10,
    role: 'so_tnmt',
    orgId: 42,
    lang: 'vi',
    ipAddress: '127.0.0.1',
    userAgent: 'jest',
    permissions: { users: { change_role: true } },
};
const citizen = {
    id: 20,
    email: 'citizen@campha.gov.vn',
    password_hash: 'secret',
    login_attempts: 0,
    locked_until: null,
    role: 'citizen',
    org_id: 42,
    is_active: true,
};

describe('user service organization scope', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        activityLogger.logActivity.mockResolvedValue();
        tokenRepository.deleteAllUserTokens.mockResolvedValue();
        cryptoHelper.hashPassword.mockResolvedValue('hash');
    });

    test('ép danh sách user theo org_id và lọc dữ liệu nhạy cảm', async () => {
        userRepository.findAll.mockResolvedValue({ items: [citizen], total: 1 });
        const result = await userService.listUsers({ roleCode: 'citizen' }, actor);
        expect(userRepository.findAll).toHaveBeenCalledWith({ roleCode: 'citizen', orgId: 42 });
        expect(result.items[0]).not.toHaveProperty('password_hash');
        expect(result.total).toBe(1);
    });

    test('từ chối actor không có tổ chức', async () => {
        await expect(userService.listUsers({}, { ...actor, orgId: null })).rejects.toBeInstanceOf(
            Api403Error,
        );
        expect(userRepository.findAll).not.toHaveBeenCalled();
    });

    test('get user từ chối khác tổ chức và user không tồn tại', async () => {
        userRepository.findById.mockResolvedValueOnce({ ...citizen, org_id: 99 });
        await expect(userService.getUserById(20, actor)).rejects.toBeInstanceOf(Api403Error);
        userRepository.findById.mockResolvedValueOnce(null);
        await expect(userService.getUserById(20, actor)).rejects.toBeInstanceOf(Api404Error);
    });

    test('get user cùng tổ chức trả DTO an toàn', async () => {
        userRepository.findById.mockResolvedValue(citizen);
        const result = await userService.getUserById(20, actor);
        expect(result).not.toHaveProperty('password_hash');
    });
});

describe('user creation', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        cryptoHelper.hashPassword.mockResolvedValue('hash');
        activityLogger.logActivity.mockResolvedValue();
    });

    test('system_admin không được tạo role đặc quyền khi DB không cấp change_role', async () => {
        await expect(
            userService.createUser(
                {
                    email: 'admin2@campha.gov.vn',
                    password: 'SafePass123',
                    fullName: 'Admin 2',
                    roleCode: 'system_admin',
                },
                { ...actor, role: 'system_admin', permissions: { users: { create: true } } },
            ),
        ).rejects.toBeInstanceOf(Api403Error);
        expect(userRepository.create).not.toHaveBeenCalled();
    });

    test('citizen không cần change_role nhưng actor phải có tổ chức', async () => {
        await expect(
            userService.createUser(
                {
                    email: 'new@example.com',
                    password: 'SafePass123',
                    fullName: 'New',
                },
                { ...actor, orgId: null, permissions: {} },
            ),
        ).rejects.toBeInstanceOf(Api403Error);
    });

    test('từ chối email đã tồn tại hoặc role không tồn tại', async () => {
        userRepository.findRoleByCode.mockResolvedValueOnce({ code: 'citizen' });
        userRepository.findByEmail.mockResolvedValueOnce(citizen);
        await expect(
            userService.createUser(
                {
                    email: citizen.email,
                    password: 'SafePass123',
                    fullName: 'Duplicate',
                },
                actor,
            ),
        ).rejects.toBeInstanceOf(Api409Error);

        userRepository.findRoleByCode.mockResolvedValueOnce(null);
        await expect(
            userService.createUser(
                {
                    email: 'new@example.com',
                    password: 'SafePass123',
                    fullName: 'New',
                },
                actor,
            ),
        ).rejects.toBeInstanceOf(Api400Error);
    });

    test('tạo user trong org actor, normalize phone rỗng và audit', async () => {
        userRepository.findByEmail.mockResolvedValue(null);
        userRepository.findRoleByCode.mockResolvedValue({ code: 'citizen' });
        userRepository.create.mockResolvedValue({ ...citizen, id: 21, password_hash: 'hash' });
        const result = await userService.createUser(
            {
                email: 'new@example.com',
                password: 'SafePass123',
                fullName: 'New',
                phone: '',
            },
            actor,
        );
        expect(userRepository.create).toHaveBeenCalledWith(
            expect.objectContaining({
                orgId: 42,
                phone: null,
                passwordHash: 'hash',
                roleCode: 'citizen',
                emailVerified: true,
            }),
        );
        expect(activityLogger.logActivity).toHaveBeenCalled();
        expect(result).not.toHaveProperty('password_hash');
    });

    test('chuyển unique violation thành conflict, lỗi khác giữ nguyên', async () => {
        userRepository.findByEmail.mockResolvedValue(null);
        userRepository.findRoleByCode.mockResolvedValue({ code: 'citizen' });
        userRepository.create.mockRejectedValueOnce({ code: PG_UNIQUE_VIOLATION });
        await expect(
            userService.createUser(
                {
                    email: 'race@example.com',
                    password: 'SafePass123',
                    fullName: 'Race',
                },
                actor,
            ),
        ).rejects.toBeInstanceOf(Api409Error);

        const dbError = new Error('db down');
        userRepository.create.mockRejectedValueOnce(dbError);
        await expect(
            userService.createUser(
                {
                    email: 'error@example.com',
                    password: 'SafePass123',
                    fullName: 'Error',
                },
                actor,
            ),
        ).rejects.toBe(dbError);
    });
});

describe('user administration mutations', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        userRepository.findById.mockResolvedValue(citizen);
        userRepository.findRoleByCode.mockResolvedValue({ code: 'so_xd' });
        userRepository.updateRole.mockResolvedValue({ ...citizen, role: 'so_xd' });
        userRepository.updateActive.mockResolvedValue({ ...citizen, is_active: false });
        userRepository.updateTemporaryPassword.mockResolvedValue({ id: 20 });
        userRepository.softDelete.mockResolvedValue({ id: 20 });
        userRepository.countActiveUsersByRole.mockResolvedValue(2);
        tokenRepository.deleteAllUserTokens.mockResolvedValue();
        userRepository.incrementTokenVersion.mockResolvedValue(1);
        cryptoHelper.hashPassword.mockResolvedValue('hash');
        activityLogger.logActivity.mockResolvedValue();
    });

    test('không đổi role chính mình; role đích phải tồn tại', async () => {
        await expect(userService.changeUserRole(actor.id, 'so_xd', actor)).rejects.toBeInstanceOf(
            Api400Error,
        );
        userRepository.findById.mockResolvedValue(citizen);
        userRepository.findRoleByCode.mockResolvedValue(null);
        await expect(userService.changeUserRole(20, 'so_xd', actor)).rejects.toBeInstanceOf(
            Api400Error,
        );
    });

    test('bảo vệ system_admin cuối cùng khi hạ role', async () => {
        userRepository.findById.mockResolvedValue({ ...citizen, role: 'system_admin' });
        userRepository.countActiveUsersByRole.mockResolvedValue(1);
        await expect(userService.changeUserRole(20, 'so_xd', actor)).rejects.toBeInstanceOf(
            Api400Error,
        );
    });

    test('đổi role hợp lệ và audit', async () => {
        const result = await userService.changeUserRole(20, 'so_xd', actor);
        expect(userRepository.updateRole).toHaveBeenCalledWith(20, 'so_xd');
        expect(userRepository.incrementTokenVersion).toHaveBeenCalledWith(20);
        expect(tokenRepository.deleteAllUserTokens).toHaveBeenCalledWith(20);
        expect(activityLogger.logActivity).toHaveBeenCalled();
        expect(result.role).toBe('so_xd');
    });

    test('không khóa chính mình và bảo vệ admin cuối', async () => {
        await expect(userService.setUserActive(actor.id, false, actor)).rejects.toBeInstanceOf(
            Api400Error,
        );
        userRepository.findById.mockResolvedValue({ ...citizen, role: 'system_admin' });
        userRepository.countActiveUsersByRole.mockResolvedValue(1);
        await expect(userService.setUserActive(20, false, actor)).rejects.toBeInstanceOf(
            Api400Error,
        );
    });

    test('khóa user thu hồi token; mở khóa không thu hồi', async () => {
        await userService.setUserActive(20, false, actor);
        expect(tokenRepository.deleteAllUserTokens).toHaveBeenCalledWith(20);
        expect(userRepository.incrementTokenVersion).toHaveBeenCalledWith(20);
        jest.clearAllMocks();
        userRepository.findById.mockResolvedValue({ ...citizen, is_active: false });
        userRepository.updateActive.mockResolvedValue(citizen);
        await userService.setUserActive(20, true, actor);
        expect(tokenRepository.deleteAllUserTokens).not.toHaveBeenCalled();
    });

    test('reset password đặt mật khẩu tạm, thu hồi token và audit', async () => {
        const result = await userService.resetUserPassword(20, 'NewPass123', actor);
        expect(cryptoHelper.hashPassword).toHaveBeenCalledWith('NewPass123');
        expect(userRepository.updateTemporaryPassword).toHaveBeenCalledWith(20, 'hash');
        expect(tokenRepository.deleteAllUserTokens).toHaveBeenCalledWith(20);
        expect(userRepository.incrementTokenVersion).toHaveBeenCalledWith(20);
        expect(result.message).toBeTruthy();
    });

    test('không tự xóa; bảo vệ admin cuối; xóa hợp lệ thu hồi token', async () => {
        await expect(userService.deleteUser(actor.id, actor)).rejects.toBeInstanceOf(Api400Error);
        userRepository.findById.mockResolvedValue({ ...citizen, role: 'system_admin' });
        userRepository.countActiveUsersByRole.mockResolvedValue(1);
        await expect(userService.deleteUser(20, actor)).rejects.toBeInstanceOf(Api400Error);

        userRepository.findById.mockResolvedValue(citizen);
        await userService.deleteUser(20, actor);
        expect(userRepository.softDelete).toHaveBeenCalledWith(20);
        expect(tokenRepository.deleteAllUserTokens).toHaveBeenCalledWith(20);
        expect(userRepository.incrementTokenVersion).toHaveBeenCalledWith(20);
        expect(activityLogger.logActivity).toHaveBeenCalled();
    });
});
