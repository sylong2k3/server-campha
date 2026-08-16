'use strict';

const { sendSchema } = require('../notification.validator');

describe('notification send validator', () => {
    test.each([
        {
            target: 'user',
            userId: 7,
            channel: 'forest',
            type: 'forest_classification_published',
            title: 'Kết quả Phân loại đối tượng mới',
            body: 'Kỳ dữ liệu mới đã được công bố.',
        },
        {
            target: 'role',
            roleCode: 'citizen',
            channel: 'flood',
            type: 'flood_warning',
            title: 'Cảnh báo ngập',
            body: 'Theo dõi thông tin trên bản đồ.',
        },
        {
            target: 'all',
            channel: 'system',
            type: 'announcement',
            title: 'Thông báo chung',
            body: 'Nội dung thông báo.',
        },
    ])('accepts the $target target payload', (payload) => {
        const { error, value } = sendSchema.validate(payload);
        expect(error).toBeUndefined();
        expect(value).toMatchObject(payload);
    });

    test('rejects target-specific fields from another target shape', () => {
        const { error } = sendSchema.validate({
            target: 'all',
            userId: 7,
            type: 'announcement',
            title: 'Thông báo',
            body: 'Nội dung',
        });
        expect(error).toBeDefined();
    });

    test('rejects an empty body', () => {
        const { error } = sendSchema.validate({
            target: 'all',
            type: 'announcement',
            title: 'Thông báo',
            body: '   ',
        });
        expect(error).toBeDefined();
    });
});
