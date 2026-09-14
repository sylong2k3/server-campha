'use strict';

const { periodDates, getSeasonContext, previousCompletedPeriod } = require('../period');

describe('forest-classification period and seasonal logic', () => {
    describe('getSeasonContext', () => {
        test('correctly maps 4 seasons and produces expected Vietnamese labels', () => {
            // Mùa Xuân (Q1: 1, 2, 3)
            const m1 = getSeasonContext(2026, 1);
            expect(m1.seasonName).toBe('mùa Xuân');
            expect(m1.startMonth).toBe(1);
            expect(m1.endMonth).toBe(3);
            expect(m1.isStartOfSeason).toBe(true);
            expect(m1.isEndOfSeason).toBe(false);
            expect(m1.label).toBe('Kết quả tháng 1 thuộc mùa Xuân năm 2026');

            const m2 = getSeasonContext(2026, 2);
            expect(m2.isStartOfSeason).toBe(false);
            expect(m2.isEndOfSeason).toBe(false);
            expect(m2.label).toBe('Kết quả từ đầu mùa đến tháng 2 thuộc mùa Xuân năm 2026');

            const m3 = getSeasonContext(2026, 3);
            expect(m3.isStartOfSeason).toBe(false);
            expect(m3.isEndOfSeason).toBe(true);
            expect(m3.label).toBe('Báo cáo toàn mùa Xuân năm 2026');

            // Mùa Hạ (Q2: 4, 5, 6)
            const m4 = getSeasonContext(2026, 4);
            expect(m4.seasonName).toBe('mùa Hạ');
            expect(m4.label).toBe('Kết quả tháng 4 thuộc mùa Hạ năm 2026');

            const m6 = getSeasonContext(2026, 6);
            expect(m6.label).toBe('Báo cáo toàn mùa Hạ năm 2026');

            // Mùa Thu (Q3: 7, 8, 9)
            const m7 = getSeasonContext(2026, 7);
            expect(m7.seasonName).toBe('mùa Thu');
            expect(m7.label).toBe('Kết quả tháng 7 thuộc mùa Thu năm 2026');

            const m8 = getSeasonContext(2026, 8);
            expect(m8.label).toBe('Kết quả từ đầu mùa đến tháng 8 thuộc mùa Thu năm 2026');

            const m9 = getSeasonContext(2026, 9);
            expect(m9.label).toBe('Báo cáo toàn mùa Thu năm 2026');
            expect(m9.isEndOfSeason).toBe(true);

            // Mùa Đông (Q4: 10, 11, 12)
            const m10 = getSeasonContext(2026, 10);
            expect(m10.seasonName).toBe('mùa Đông');
            expect(m10.label).toBe('Kết quả tháng 10 thuộc mùa Đông năm 2026');
            expect(m10.isStartOfSeason).toBe(true);

            const m11 = getSeasonContext(2026, 11);
            expect(m11.label).toBe('Kết quả từ đầu mùa đến tháng 11 thuộc mùa Đông năm 2026');

            const m12 = getSeasonContext(2026, 12);
            expect(m12.label).toBe('Báo cáo toàn mùa Đông năm 2026');
            expect(m12.isEndOfSeason).toBe(true);
        });
    });

    describe('periodDates', () => {
        test('composites from season start through the target month', () => {
            // Month 9 (Thu end): starts from July 1st, ends Oct 1st
            const p9 = periodDates(2026, 9);
            expect(p9.startDate).toBe('2026-07-01');
            expect(p9.endDate).toBe('2026-10-01');

            // Month 8 (Thu intermediate): starts from July 1st, ends Sep 1st
            const p8 = periodDates(2026, 8);
            expect(p8.startDate).toBe('2026-07-01');
            expect(p8.endDate).toBe('2026-09-01');

            // Month 10 (Dong start): starts from Oct 1st, ends Nov 1st
            const p10 = periodDates(2026, 10);
            expect(p10.startDate).toBe('2026-10-01');
            expect(p10.endDate).toBe('2026-11-01');

            // Month 12 (Dong end): starts from Oct 1st, ends next year Jan 1st
            const p12 = periodDates(2026, 12);
            expect(p12.startDate).toBe('2026-10-01');
            expect(p12.endDate).toBe('2027-01-01');
        });
    });

    describe('previousCompletedPeriod', () => {
        test('returns the completed previous month', () => {
            const oct1 = new Date('2026-10-01T00:00:00+07:00');
            const res = previousCompletedPeriod(oct1, 'Asia/Ho_Chi_Minh');
            expect(res).toEqual({ year: 2026, month: 9 });
        });
    });
});
