'use strict';

/** @type {import('jest').Config} */
module.exports = {
    testEnvironment: 'node',
    testMatch: ['**/__tests__/**/*.test.js'],
    testPathIgnorePatterns: ['/node_modules/', '/__tests__/integration/'],
    collectCoverageFrom: [
        'src/database/migrate.js',
        'src/middlewares/auth.middleware.js',
        'src/middlewares/layer-access.middleware.js',
        'src/services/systemLog.service.js',
        'src/services/user.service.js',
        'src/services/mfa.service.js',
        'src/services/storage.service.js',
        'src/services/clamav.service.js',
        'src/services/map-proxy.service.js',
        'src/utils/file-signature.util.js',
        'src/geo/srid.util.js',
        'src/utils/totp.util.js',
    ],
    coverageReporters: ['text', 'lcov'],
    coverageThreshold: {
        global: { branches: 75 },
    },
    testTimeout: 30000,
};
