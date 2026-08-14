'use strict';

const periodDates = (year, month) => {
    const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
    const end = new Date(Date.UTC(year, month, 0));
    return { startDate, endDate: end.toISOString().slice(0, 10) };
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
