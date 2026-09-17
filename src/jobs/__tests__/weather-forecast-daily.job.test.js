'use strict';

const job = require('../weather-forecast-daily.job');
const weatherService = require('../../services/flood/weather.service');

describe('weather-forecast-daily.job', () => {
    afterEach(() => {
        job.__resetForTests();
        jest.restoreAllMocks();
    });

    test('has default settings for 00:00 Asia/Ho_Chi_Minh', () => {
        const s = job.settings();
        expect(s.enabled).toBe(true);
        expect(s.expression).toBe('0 0 * * *');
        expect(s.timezone).toBe('Asia/Ho_Chi_Minh');
    });

    test('start and stop lifecycle', () => {
        const startResult = job.start();
        expect(startResult.started).toBe(true);

        // Gọi lần 2 không lặp
        const secondStart = job.start();
        expect(secondStart.started).toBe(false);
        expect(secondStart.reason).toBe('ALREADY_STARTED');

        job.stop();
    });

    test('runScheduled calls refreshForecast24h and handles errors safely', async () => {
        const spy = jest.spyOn(weatherService, 'refreshForecast24h').mockResolvedValue({
            forecastDate: '2026-09-18',
            hours: Array.from({ length: 24 }),
        });

        const successRes = await job.runScheduled();
        expect(successRes.success).toBe(true);
        expect(spy).toHaveBeenCalledTimes(1);

        // Xử lý lỗi mà không văng ngoại lệ ra ngoài
        spy.mockRejectedValueOnce(new Error('WeatherAPI quota exceeded'));
        const failureRes = await job.runScheduled();
        expect(failureRes.success).toBe(false);
        expect(failureRes.error).toContain('WeatherAPI quota exceeded');
    });
});
