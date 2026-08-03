const { createUserSchema } = require('../user.validator');

describe('user validator contract', () => {
    test('chấp nhận local account và từ chối field ngoài contract', () => {
        expect(
            createUserSchema.validate({
                email: 'staff@campha.gov.vn',
                password: 'SafePass123!',
                fullName: 'Cán bộ Cẩm Phả',
            }).error,
        ).toBeUndefined();
        expect(
            createUserSchema.validate({
                email: 'staff@campha.gov.vn',
                password: 'SafePass123!',
                unsupportedField: 'unexpected',
            }).error,
        ).toBeTruthy();
    });
});
