'use strict';

/** @type {import('jest').Config} */
module.exports = {
    testEnvironment: 'node',
    testMatch: ['**/src/routes/**/*.test.js'],
    testPathIgnorePatterns: ['/node_modules/', '/__tests__/integration/'],
    testTimeout: 30000,
};
