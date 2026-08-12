'use strict';

const M5_ARTIFACTS = Object.freeze([
    { code: 'trend_frequency', role: 'PRODUCT', style: 'trend_frequency', label: { vi: 'Tần suất ngập (%)', en: 'Flood frequency (%)' } },
    { code: 'trend_frequent_flood', role: 'PRODUCT', style: 'trend_frequent_flood', label: { vi: 'Vùng ngập tái diễn', en: 'Frequent flood' } },
    { code: 'trend_new_flood', role: 'PRODUCT', style: 'trend_new_flood', label: { vi: 'Vùng ngập mới', en: 'New flood' } },
    { code: 'pond_to_built', role: 'PRODUCT', style: 'pond_to_built', label: { vi: 'Ao/mặt nước chuyển sang xây dựng', en: 'Pond-to-built' } },
    { code: 'drainage_sensitive', role: 'PRODUCT', style: 'drainage_sensitive', label: { vi: 'Vùng nhạy cảm tiêu thoát', en: 'Drainage-sensitive' } },
    { code: 'encroachment_alert', role: 'PRODUCT', style: 'encroachment_alert', label: { vi: 'Cảnh báo lấn chiếm', en: 'Encroachment alert' } },
    { code: 'trend_tidal_candidate', role: 'QA', style: 'trend_tidal_candidate', label: { vi: 'Ứng viên vùng triều (QA)', en: 'Tidal candidate (QA)' } },
    { code: 'trend_mining_candidate', role: 'QA', style: 'trend_mining_candidate', label: { vi: 'Ứng viên vùng mỏ (QA)', en: 'Mining candidate (QA)' } },
]);

function selectM5Artifacts({ runMode = 'product' } = {}) {
    return M5_ARTIFACTS.map((artifact) => ({
        ...artifact,
        description: artifact.label.en,
        role: runMode === 'calibration' && artifact.role === 'QA' ? 'CALIBRATION' : artifact.role,
    }));
}

module.exports = { M5_ARTIFACTS, selectM5Artifacts };
