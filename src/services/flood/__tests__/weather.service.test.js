'use strict';

const weatherService = require('../weather.service');
const weatherapi = require('../../../utils/weatherapi.client');

describe('flood weather.service', () => {
    beforeEach(() => {
        weatherService.__resetCacheForTests();
        jest.restoreAllMocks();
    });

    const mockForecastData = {
        location: { name: 'Cẩm Phả', lat: 21.0024, lon: 107.3037 },
        forecastDate: '2026-09-18',
        hours: Array.from({ length: 24 }, (_, i) => ({
            time: `2026-09-18 ${String(i).padStart(2, '0')}:00`,
            hour: `${String(i).padStart(2, '0')}:00`,
            precipMm: i === 12 ? 30.5 : 0,
            chanceOfRain: i === 12 ? 90 : 10,
        })),
        source: 'weatherapi',
        fetchedAt: new Date().toISOString(),
    };

    test('fetches and caches forecast on first call', async () => {
        const spy = jest.spyOn(weatherapi, 'getHourlyForecast').mockResolvedValue(mockForecastData);

        const first = await weatherService.getForecast24h();
        expect(first.forecastDate).toBe('2026-09-18');
        expect(spy).toHaveBeenCalledTimes(1);

        // Lần thứ 2 lấy từ cache, không gọi lại client
        const second = await weatherService.getForecast24h();
        expect(second).toBe(first);
        expect(spy).toHaveBeenCalledTimes(1);
    });

    test('refreshForecast24h forces upstream call and updates cache', async () => {
        const spy = jest.spyOn(weatherapi, 'getHourlyForecast').mockResolvedValue(mockForecastData);

        await weatherService.getForecast24h();
        expect(spy).toHaveBeenCalledTimes(1);

        const updatedData = { ...mockForecastData, fetchedAt: new Date().toISOString() };
        spy.mockResolvedValueOnce(updatedData);

        const refreshed = await weatherService.refreshForecast24h();
        expect(spy).toHaveBeenCalledTimes(2);
        expect(refreshed).toBe(updatedData);
    });

    test('deduplicates concurrent requests', async () => {
        let resolvePromise;
        const pendingPromise = new Promise((res) => {
            resolvePromise = res;
        });

        const spy = jest.spyOn(weatherapi, 'getHourlyForecast').mockReturnValue(pendingPromise);

        // Gọi đồng thời 3 request
        const p1 = weatherService.getForecast24h();
        const p2 = weatherService.getForecast24h();
        const p3 = weatherService.getForecast24h();

        resolvePromise(mockForecastData);

        const [r1, r2, r3] = await Promise.all([p1, p2, p3]);
        expect(r1).toBe(mockForecastData);
        expect(r2).toBe(mockForecastData);
        expect(r3).toBe(mockForecastData);
        expect(spy).toHaveBeenCalledTimes(1);
    });

    test('retains existing cache when refresh fails', async () => {
        const spy = jest.spyOn(weatherapi, 'getHourlyForecast').mockResolvedValue(mockForecastData);

        // Lần 1 thành công
        await weatherService.getForecast24h();
        expect(weatherService.getCachedForecast()).toBe(mockForecastData);

        // Lần 2 refresh gặp lỗi mạng
        spy.mockRejectedValueOnce(new Error('Network timeout'));
        await expect(weatherService.refreshForecast24h()).rejects.toThrow('Network timeout');

        // Cache cũ vẫn còn
        expect(weatherService.getCachedForecast()).toBe(mockForecastData);
    });
});
