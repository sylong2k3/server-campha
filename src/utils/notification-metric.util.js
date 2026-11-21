'use strict';

// Notification metrics may arrive as PostgreSQL numeric strings. Missing values
// and malformed/non-finite values must never become zero or visible NaN/Infinity.
const notificationMetric = (value) => {
    if (typeof value !== 'number' && typeof value !== 'string') {
        return null;
    }
    if (typeof value === 'string' && value.trim() === '') {
        return null;
    }
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? number : null;
};

module.exports = { notificationMetric };

