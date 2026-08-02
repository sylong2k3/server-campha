'use strict';

/** @type {import('jest').Config} */
module.exports = {
    testEnvironment: 'node',
    testMatch: ['**/__tests__/**/*.test.js'],
    testPathIgnorePatterns: ['/node_modules/', '/__tests__/integration/'],
    collectCoverageFrom: ['src/**/*.js', '!src/**/__tests__/**', '!src/database/seeds/**'],
    coverageReporters: ['text', 'lcov'],
    // Đo trên toàn bộ src/ (trước đây collectCoverageFrom chỉ liệt kê tay 15
    // file, branches 75% — số đẹp nhưng đo trên tập được chọn sẵn). Ngưỡng
    // dưới đây là sàn thật của toàn bộ src/ (đo 2026-08-03, có margin an toàn
    // nhỏ), không phải mục tiêu — chỉ để chặn regression, không đại diện cho
    // chất lượng test mong muốn. Nâng dần khi thêm test cho service/repository
    // còn thiếu (đặc biệt controllers/, workers/, queues/ hiện ~0%).
    coverageThreshold: {
        global: { branches: 27, statements: 35, lines: 35, functions: 27 },
    },
    testTimeout: 30000,
};
