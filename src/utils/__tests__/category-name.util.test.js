'use strict';

const { formatCategoryNameVi } = require('../category-name.util');

describe('formatCategoryNameVi', () => {
    test('maps raw English and unaccented categories to Vietnamese', () => {
        expect(formatCategoryNameVi('Flood', 'Flood')).toBe('Ngập lụt');
        expect(formatCategoryNameVi('Forest', 'Forest')).toBe('Phân loại đối tượng');
        expect(formatCategoryNameVi('Lop-phu-ngap', 'Lop-phu-ngap')).toBe('Lớp phủ ngập');
        expect(formatCategoryNameVi('Ranh Gioi', 'Ranh Gioi')).toBe('Ranh giới');
        expect(formatCategoryNameVi('Thoat Nuoc', 'Thoat Nuoc')).toBe('Thoát nước');
    });

    test('preserves existing custom Vietnamese categoryName if set', () => {
        expect(formatCategoryNameVi('custom', 'Lớp tùy chỉnh')).toBe('Lớp tùy chỉnh');
    });

    test('fallback formats unknown raw category', () => {
        expect(formatCategoryNameVi('some_category', null)).toBe('Some category');
    });
});
