'use strict';

jest.mock('../../../configs/gge', () => ({ ee: {} }));
jest.mock('../../gee-earth-engine.adapter', () => ({ ensureInitialized: jest.fn() }));
jest.mock('../../../repositories/flood-analysis-run.repository', () => ({
    findById: jest.fn(),
    startRun: jest.fn(),
    updateStatus: jest.fn(),
    createStageEvent: jest.fn(),
    finishRun: jest.fn(),
}));
jest.mock('../../../repositories/flood-artifact.repository', () => ({}));
jest.mock('../../../repositories/raster-ingest.repository', () => ({}));
jest.mock('../../raster-ingest.service', () => ({}));
jest.mock('../common/geometry', () => ({ loadAoi: jest.fn(() => ({ geometry: {} })) }));
jest.mock('../debug.util', () => ({ log: jest.fn(), logError: jest.fn() }));
jest.mock('../trend/final/index', () => ({ runTrendAnalysisFinal: jest.fn() }));
jest.mock('../../notification-events.service', () => ({
    notifyFloodRunCompleted: jest.fn(),
    notifyFloodRunFailed: jest.fn(),
}));

const runRepo = require('../../../repositories/flood-analysis-run.repository');
const { runTrendAnalysisFinal } = require('../trend/final/index');
const notificationEvents = require('../../notification-events.service');
const { executePersistedRun } = require('../run-executor.service');

// No external GEE, database, ingest or notification operations are performed.
describe('executePersistedRun completion notification', () => {
    const run = { id: '14', module: 'trend', mode: 'product', attempt_no: 2 };
    const warnings = ['NON_COMMERCIAL_DTM_FABDEM'];

    beforeEach(() => {
        jest.clearAllMocks();
        runRepo.findById.mockResolvedValue(run);
    });

    test.each([
        ['trend area stats', { areaStats: { floodExtentAreaHa: 665.4 } }, 665.4],
        ['zero trend area', { areaStats: { floodExtentAreaHa: 0 }, mainAreaHa: 10 }, 0],
        ['event area', { mainAreaHa: 1520.5 }, 1520.5],
        ['impact area', { floodAreaHa: 250.2 }, 250.2],
        ['HAND scenario area', { scenarioAreaHa: 314.15 }, 314.15],
        ['numeric string area', { mainAreaHa: '12.5' }, 12.5],
        ['malformed area', { mainAreaHa: 'invalid' }, null],
        ['blank area', { mainAreaHa: '' }, null],
        ['nonfinite area', { mainAreaHa: Infinity }, null],
        ['missing area', {}, null],
    ])('passes %s to the notification', async (_label, metadata, expectedArea) => {
        runTrendAnalysisFinal.mockResolvedValue({
            metadata: { ...metadata, warnings },
            artifacts: {},
            catalog: [],
        });

        const result = await executePersistedRun({ runId: run.id });

        expect(result.status).toBe('SUCCEEDED');
        expect(runRepo.finishRun).toHaveBeenCalledWith(run.id, {
            status: 'SUCCEEDED',
            warnings,
            resultMetadata: { ...metadata, warnings },
        });
        expect(notificationEvents.notifyFloodRunCompleted).toHaveBeenCalledWith(run, {
            floodAreaHa: expectedArea,
            floodPercentage: expectedArea === null ? null : (expectedArea / 33584) * 100,
            warnings,
        });
        expect(notificationEvents.notifyFloodRunFailed).not.toHaveBeenCalled();
    });
});
