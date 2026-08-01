'use strict';

const base = require('./jest.config');

module.exports = {
    ...base,
    testMatch: ['**/src/database/__tests__/integration/**/*.test.js'],
    testPathIgnorePatterns: ['/node_modules/'],
    collectCoverage: false,
};
