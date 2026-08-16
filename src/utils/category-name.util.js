'use strict';

const CATEGORY_MAP_VI = {
    flood: 'Ngập lụt',
    forest: 'Phân loại đối tượng',
    'lop-phu-ngap': 'Lớp phủ ngập',
    'ranh gioi': 'Ranh giới',
    ranh_gioi: 'Ranh giới',
    boundary: 'Ranh giới hành chính',
    administrative: 'Ranh giới hành chính',
    'thoat nuoc': 'Thoát nước',
    thoat_nuoc: 'Thoát nước',
    land_cover: 'Lớp phủ mặt đất',
    remote_sensing: 'Ảnh viễn thám',
    hydrology: 'Thủy văn',
    giao_thong: 'Giao thông',
    transportation: 'Giao thông',
    transport: 'Giao thông',
    infrastructure: 'Hạ tầng',
    environment: 'Môi trường',
    agriculture: 'Nông nghiệp',
    forestry: 'Lâm nghiệp',
    weather: 'Thời tiết',
};

const formatCategoryNameVi = (category, categoryName) => {
    if (categoryName && !CATEGORY_MAP_VI[categoryName.toLowerCase().trim()]) {
        return categoryName;
    }
    const key = (category || categoryName || '').toLowerCase().trim();
    if (CATEGORY_MAP_VI[key]) {
        return CATEGORY_MAP_VI[key];
    }
    if (categoryName) {
        return categoryName;
    }
    return category
        ? category.charAt(0).toUpperCase() + category.slice(1).replace(/[-_]/g, ' ')
        : null;
};

module.exports = {
    formatCategoryNameVi,
    CATEGORY_MAP_VI,
};
