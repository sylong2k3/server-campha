jest.mock('passport', () => ({ authenticate: jest.fn() }));

const passport = require('passport');
const { Api401Error, Api403Error } = require('../../core/error.response');
const {
    verifyToken,
    requireRole,
    enforcePasswordChange,
    optionalAuth,
    hasPermission,
    requirePermission,
} = require('../auth.middleware');

const mockPassport = (callbackArgs) => {
    passport.authenticate.mockImplementation(
        (_strategy, _options, callback) => (req, res, next) =>
            callback(...callbackArgs, req, res, next),
    );
};

describe('authentication middleware', () => {
    beforeEach(() => jest.clearAllMocks());

    test('verifyToken chuyển lỗi Passport cho error handler', () => {
        const error = new Error('passport failed');
        mockPassport([error]);
        const next = jest.fn();
        verifyToken({}, {}, next);
        expect(next).toHaveBeenCalledWith(error);
    });

    test('verifyToken từ chối khi không có user', () => {
        mockPassport([null, false, { message: 'invalid jwt' }]);
        const next = jest.fn();
        verifyToken({ lang: 'vi' }, {}, next);
        expect(next.mock.calls[0][0]).toBeInstanceOf(Api401Error);
        expect(next.mock.calls[0][0].message).toBe('invalid jwt');
    });

    test('verifyToken gắn user rồi tiếp tục', () => {
        const user = { id: 1 };
        mockPassport([null, user]);
        const req = {};
        const next = jest.fn();
        verifyToken(req, {}, next);
        expect(req.user).toBe(user);
        expect(next).toHaveBeenCalledWith();
    });

    test('optionalAuth chuyển lỗi Passport', () => {
        const error = new Error('passport failed');
        mockPassport([error]);
        const next = jest.fn();
        optionalAuth({}, {}, next);
        expect(next).toHaveBeenCalledWith(error);
    });

    test.each([
        [false, null],
        [{ id: 2 }, { id: 2 }],
    ])('optionalAuth chấp nhận anonymous hoặc user %#', (passportUser, expected) => {
        mockPassport([null, passportUser]);
        const req = {};
        const next = jest.fn();
        optionalAuth(req, {}, next);
        expect(req.user).toEqual(expected);
        expect(next).toHaveBeenCalledWith();
    });
});

describe('authorization middleware', () => {
    test('requireRole yêu cầu đăng nhập', () => {
        expect(() => requireRole('so_tnmt')({ lang: 'vi' }, {}, jest.fn())).toThrow(Api401Error);
    });

    test('requireRole từ chối role ngoài allowlist', () => {
        expect(() =>
            requireRole('so_tnmt')({ user: { role: 'citizen' }, lang: 'en' }, {}, jest.fn()),
        ).toThrow(Api403Error);
    });

    test('requireRole cho phép role hợp lệ', () => {
        const next = jest.fn();
        requireRole('so_tnmt', 'so_xd')({ user: { role: 'so_xd' }, lang: 'vi' }, {}, next);
        expect(next).toHaveBeenCalledWith();
    });

    test('enforcePasswordChange yêu cầu đăng nhập', () => {
        expect(() => enforcePasswordChange({ lang: 'vi' }, {}, jest.fn())).toThrow(Api401Error);
    });

    test('enforcePasswordChange chặn mật khẩu tạm', () => {
        expect(() =>
            enforcePasswordChange(
                {
                    user: { must_change_password: true },
                    lang: 'vi',
                },
                {},
                jest.fn(),
            ),
        ).toThrow(Api403Error);
    });

    test('enforcePasswordChange cho phép mật khẩu bình thường', () => {
        const next = jest.fn();
        enforcePasswordChange({ user: { must_change_password: false } }, {}, next);
        expect(next).toHaveBeenCalledWith();
    });

    test('requirePermission yêu cầu đăng nhập', () => {
        expect(() => requirePermission('layers', 'delete')({ lang: 'vi' }, {}, jest.fn())).toThrow(
            Api401Error,
        );
    });

    test('không bypass system_admin khi DB không cấp quyền', () => {
        const middleware = requirePermission('layers', 'delete');
        const req = {
            user: { role: 'system_admin', role_permissions: { layers: { read: true } } },
            lang: 'vi',
        };
        expect(() => middleware(req, {}, jest.fn())).toThrow(Api403Error);
    });

    test('cho phép mọi role khi DB cấp đúng quyền', () => {
        const middleware = requirePermission('layers', 'delete');
        const next = jest.fn();
        const req = {
            user: { role: 'so_tnmt', role_permissions: { layers: { delete: true } } },
            lang: 'vi',
        };
        middleware(req, {}, next);
        expect(next).toHaveBeenCalledTimes(1);
    });
});

describe('hasPermission', () => {
    test.each([
        [null],
        ['invalid'],
        [{}],
        [{ layers: 'invalid' }],
        [{ layers: {} }],
        [{ layers: { delete: false } }],
    ])('mặc định từ chối permission không hợp lệ %#', (permissions) => {
        expect(hasPermission(permissions, 'layers', 'delete')).toBe(false);
    });

    test('chỉ chấp nhận boolean true', () => {
        expect(hasPermission({ layers: { delete: true } }, 'layers', 'delete')).toBe(true);
    });
});
