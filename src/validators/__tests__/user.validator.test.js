const { createUserSchema } = require('../user.validator');

describe('user validator local-only contract', () => {
    test('chấp nhận local account và từ chối field LDAP đã retire', () => {
        expect(
            createUserSchema.validate({
                email: 'staff@campha.gov.vn',
                password: 'SafePass123!',
                fullName: 'Cán bộ Cẩm Phả',
            }).error,
        ).toBeUndefined();
        expect(
            createUserSchema.validate({
                authProvider: 'ldap',
                directoryUsername: 'staff',
            }).error,
        ).toBeTruthy();
    });
});
