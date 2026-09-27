'use strict';

const job = require('../flood-scenario-auto.job');
const forecastScenarioService = require('../../services/flood/forecast-scenario.service');

describe('flood-scenario-auto.job', () => {
    afterEach(() => {
        job.__resetForTests();
        jest.restoreAllMocks();
    });

    test('has default settings for hourly execution (0 * * * *) in Asia/Ho_Chi_Minh', () => {
        const s = job.settings();
        expect(s.enabled).toBe(true);
        expect(s.expression).toBe('0 * * * *');
        expect(s.timezone).toBe('Asia/Ho_Chi_Minh');
    });

    test('start and stop lifecycle', () => {
        const startResult = job.start();
        expect(startResult.started).toBe(true);

        const secondStart = job.start();
        expect(secondStart.started).toBe(false);
        expect(secondStart.reason).toBe('ALREADY_STARTED');

        job.stop();
    });

    test('runScheduled calls processDueScheduleSlots and handles errors safely', async () => {
        const spy = jest.spyOn(forecastScenarioService, 'processDueScheduleSlots').mockResolvedValue({
            processed: 5,
            applied: 2,
            skipped: 3,
            errors: 0,
        });

        const successRes = await job.runScheduled();
        expect(successRes.success).toBe(true);
        expect(successRes.processed).toBe(5);
        expect(successRes.applied).toBe(2);
        expect(spy).toHaveBeenCalledTimes(1);

        spy.mockRejectedValueOnce(new Error('DB connection timeout'));
        const failureRes = await job.runScheduled();
        expect(failureRes.success).toBe(false);
        expect(failureRes.error).toContain('DB connection timeout');
    });
});
