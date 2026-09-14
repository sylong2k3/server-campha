'use strict';

/**
 * Phân kỳ 4 mùa cho phân loại rừng tại Cẩm Phả (Quảng Ninh):
 *   - Mùa Xuân: Tháng 1 - 3 (Q1)
 *   - Mùa Hạ:  Tháng 4 - 6 (Q2)
 *   - Mùa Thu:  Tháng 7 - 9 (Q3)
 *   - Mùa Đông: Tháng 10 - 12 (Q4)
 *
 * Quy tắc tổng hợp ảnh:
 *   - Tháng đầu mùa: tổng hợp dữ liệu tháng đó.
 *   - Tháng giữa mùa: tổng hợp tích luỹ từ đầu mùa đến tháng hiện tại.
 *   - Tháng kết mùa: tổng hợp toàn mùa và lập báo cáo toàn mùa.
 */
const SEASONS = Object.freeze({
    1: { name: 'mùa Xuân', startMonth: 1, endMonth: 3 },
    2: { name: 'mùa Xuân', startMonth: 1, endMonth: 3 },
    3: { name: 'mùa Xuân', startMonth: 1, endMonth: 3 },
    4: { name: 'mùa Hạ', startMonth: 4, endMonth: 6 },
    5: { name: 'mùa Hạ', startMonth: 4, endMonth: 6 },
    6: { name: 'mùa Hạ', startMonth: 4, endMonth: 6 },
    7: { name: 'mùa Thu', startMonth: 7, endMonth: 9 },
    8: { name: 'mùa Thu', startMonth: 7, endMonth: 9 },
    9: { name: 'mùa Thu', startMonth: 7, endMonth: 9 },
    10: { name: 'mùa Đông', startMonth: 10, endMonth: 12 },
    11: { name: 'mùa Đông', startMonth: 10, endMonth: 12 },
    12: { name: 'mùa Đông', startMonth: 10, endMonth: 12 },
});

const getSeasonContext = (year, month) => {
    const m = Math.max(1, Math.min(12, Number(month) || 1));
    const season = SEASONS[m] || SEASONS[1];
    const isEndOfSeason = m === season.endMonth;
    const isStartOfSeason = m === season.startMonth;
    let label = '';
    if (isEndOfSeason) {
        label = `Báo cáo toàn ${season.name} năm ${year}`;
    } else if (isStartOfSeason) {
        label = `Kết quả tháng ${m} thuộc ${season.name} năm ${year}`;
    } else {
        label = `Kết quả từ đầu mùa đến tháng ${m} thuộc ${season.name} năm ${year}`;
    }
    return {
        year: Number(year),
        month: m,
        seasonName: season.name,
        startMonth: season.startMonth,
        endMonth: season.endMonth,
        isEndOfSeason,
        isStartOfSeason,
        label,
    };
};

const periodDates = (year, month) => {
    const context = getSeasonContext(year, month);
    const startDate = `${year}-${String(context.startMonth).padStart(2, '0')}-01`;
    // GEE filterDate is end-exclusive: use first day of the month AFTER the target month
    const endExclusive = new Date(Date.UTC(Number(year), context.month, 1));
    return {
        startDate,
        endDate: endExclusive.toISOString().slice(0, 10),
        seasonContext: context,
    };
};

const previousCompletedPeriod = (now = new Date(), timezone = 'Asia/Ho_Chi_Minh') => {
    const values = Object.fromEntries(
        new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit' })
            .formatToParts(now)
            .map((part) => [part.type, part.value]),
    );
    const previous = new Date(Date.UTC(Number(values.year), Number(values.month) - 2, 1));
    return { year: previous.getUTCFullYear(), month: previous.getUTCMonth() + 1 };
};

module.exports = {
    periodDates,
    previousCompletedPeriod,
    getSeasonContext,
    SEASONS,
};
