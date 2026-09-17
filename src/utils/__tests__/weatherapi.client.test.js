'use strict';

const weatherapi = require('../weatherapi.client');
const cfg = require('../../configs/weather');

describe('weatherapi.client', () => {
    const originalFetch = global.fetch;

    afterEach(() => {
        global.fetch = originalFetch;
        jest.restoreAllMocks();
    });

    test('throws if WeatherAPI is not configured', async () => {
        jest.spyOn(cfg, 'isWeatherApiConfigured').mockReturnValue(false);

        await expect(weatherapi.getHourlyForecast(21.0, 107.3)).rejects.toMatchObject({
            code: 'WEATHERAPI_NOT_CONFIGURED',
        });
    });

    test('calls upstream with correct query params and parses 24 hours', async () => {
        jest.spyOn(cfg, 'isWeatherApiConfigured').mockReturnValue(true);

        const mockHours = Array.from({ length: 24 }, (_, i) => ({
            time: `2026-09-18 ${String(i).padStart(2, '0')}:00`,
            time_epoch: 1789689600 + i * 3600,
            temp_c: 24 + (i % 5),
            feelslike_c: 26 + (i % 5),
            humidity: 80,
            precip_mm: i === 10 ? 12.5 : 0.0,
            chance_of_rain: i === 10 ? 80 : 10,
            condition: { text: 'Nhiều mây', icon: '//cdn/cloud.png', code: 1003 },
            wind_kph: 8.5,
            wind_dir: 'NE',
            uv: i >= 6 && i <= 17 ? 4 : 0,
        }));

        const mockResponse = {
            location: {
                name: 'Cẩm Phả',
                region: 'Quảng Ninh',
                country: 'Vietnam',
                lat: 21.0024,
                lon: 107.3037,
                localtime: '2026-09-18 08:00',
            },
            forecast: {
                forecastday: [
                    {
                        date: '2026-09-18',
                        day: {
                            maxtemp_c: 30.0,
                            mintemp_c: 23.0,
                            avgtemp_c: 26.5,
                            totalprecip_mm: 12.5,
                            daily_chance_of_rain: 80,
                            condition: { text: 'Có mưa rào', icon: '//cdn/rain.png', code: 1240 },
                        },
                        hour: mockHours,
                    },
                ],
            },
        };

        global.fetch = jest.fn().mockResolvedValue({
            ok: true,
            json: async () => mockResponse,
        });

        const result = await weatherapi.getHourlyForecast(21.0024, 107.3037, 'vi');

        expect(global.fetch).toHaveBeenCalledTimes(1);
        const calledUrl = new URL(global.fetch.mock.calls[0][0]);
        expect(calledUrl.pathname).toContain('/forecast.json');
        expect(calledUrl.searchParams.get('q')).toBe('21.0024,107.3037');
        expect(calledUrl.searchParams.get('days')).toBe('1');
        expect(calledUrl.searchParams.get('lang')).toBe('vi');

        expect(result.source).toBe('weatherapi');
        expect(result.forecastDate).toBe('2026-09-18');
        expect(result.hours).toHaveLength(24);
        expect(result.hours[10].hour).toBe('10:00');
        expect(result.hours[10].precipMm).toBe(12.5);
        expect(result.hours[10].chanceOfRain).toBe(80);
        expect(result.metadata).toEqual(mockResponse);
    });

    test('handles upstream errors without leaking secret', async () => {
        jest.spyOn(cfg, 'isWeatherApiConfigured').mockReturnValue(true);

        global.fetch = jest.fn().mockResolvedValue({
            ok: false,
            status: 401,
            json: async () => ({ error: { message: 'API key is invalid or disabled' } }),
        });

        await expect(weatherapi.getHourlyForecast(21.0, 107.3)).rejects.toMatchObject({
            code: 'WEATHERAPI_UPSTREAM_ERROR',
            status: 401,
        });
    });

    test('throws if response is missing forecast hours', async () => {
        jest.spyOn(cfg, 'isWeatherApiConfigured').mockReturnValue(true);

        global.fetch = jest.fn().mockResolvedValue({
            ok: true,
            json: async () => ({ location: { name: 'Cẩm Phả' }, forecast: {} }),
        });

        await expect(weatherapi.getHourlyForecast(21.0, 107.3)).rejects.toMatchObject({
            code: 'WEATHERAPI_MALFORMED_DATA',
        });
    });
});
