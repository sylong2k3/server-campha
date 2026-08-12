'use strict';

jest.mock('../../utils/systemLogger.util', () => ({ logError: jest.fn() }));
const { errorHandler } = require('../error-handler');

describe('error handler cleanup guard', () => {
    test('maps pending file reference constraint to 409', () => {
        const response = {};
        const res = {
            headersSent: false,
            status: jest.fn(() => res),
            json: jest.fn((body) => Object.assign(response, body)),
        };
        errorHandler(
            {
                code: '23514',
                constraint: 'file_cleanup_reference_guard',
                message: 'File is pending deletion',
            },
            { method: 'POST', originalUrl: '/api/v1/test', lang: 'vi' },
            res,
            jest.fn(),
        );
        expect(res.status).toHaveBeenCalledWith(409);
        expect(response).toEqual({
            success: false,
            message: 'File đang chờ xóa',
            errors: ['FILE_DELETE_PENDING'],
        });
    });

    test('maps non-ready cleanup target to 409', () => {
        const response = {};
        const res = {
            headersSent: false,
            status: jest.fn(() => res),
            json: jest.fn((body) => Object.assign(response, body)),
        };
        errorHandler(
            { code: 'FILE_NOT_READY_FOR_DELETE' },
            { method: 'DELETE', originalUrl: '/api/v1/test', lang: 'vi' },
            res,
            jest.fn(),
        );
        expect(res.status).toHaveBeenCalledWith(409);
        expect(response.errors).toEqual(['FILE_NOT_READY_FOR_DELETE']);
    });
});
