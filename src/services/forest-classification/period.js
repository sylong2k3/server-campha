'use strict';

// Seasonal representative months and their 3-month window:
//   3  → Xuân: Jan–Mar  (startMonth=1)
//   6  → Hạ:  Apr–Jun  (startMonth=4)
//   9  → Thu: Jul–Sep  (startMonth=7)
//   12 → Đông: Oct–Dec (startMonth=10)
const SEASON_START_MONTH = { 3: 1, 6: 4, 9: 7, 12: 10 };

const periodDates = (year, month) => {
    const startMonth = SEASON_START_MONTH[month] ?? month;
    const startDate = `${year}-${String(startMonth).padStart(2, '0')}-01`;
    // GEE filterDate is end-exclusive: use first day of the month AFTER the season end
    // e.g. season ending March → endDate = April 1 so March 31 is included
    const endExclusive = new Date(Date.UTC(year, month, 1));
    return { startDate, endDate: endExclusive.toISOString().slice(0, 10) };
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

module.exports = { periodDates, previousCompletedPeriod };
