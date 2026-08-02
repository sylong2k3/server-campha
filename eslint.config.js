const js = require('@eslint/js');

module.exports = [
    {
        ignores: [
            'node_modules/**',
            'coverage/**',
            'public/**',
            '.audit-report.json',
            'scripts/api-test-full.js',
            'scripts/reset-and-seed.js',
        ],
    },
    js.configs.recommended,
    {
        files: ['**/*.js', '**/*.cjs'],
        languageOptions: {
            ecmaVersion: 2024,
            sourceType: 'commonjs',
            globals: {
                AbortController: 'readonly',
                Buffer: 'readonly',
                URL: 'readonly',
                URLSearchParams: 'readonly',
                __dirname: 'readonly',
                beforeAll: 'readonly',
                beforeEach: 'readonly',
                afterAll: 'readonly',
                clearInterval: 'readonly',
                clearTimeout: 'readonly',
                console: 'readonly',
                describe: 'readonly',
                expect: 'readonly',
                exports: 'writable',
                fetch: 'readonly',
                global: 'readonly',
                it: 'readonly',
                jest: 'readonly',
                module: 'writable',
                process: 'readonly',
                require: 'readonly',
                setInterval: 'readonly',
                setTimeout: 'readonly',
                test: 'readonly',
            },
        },
        rules: {
            'no-console': 'off',
            'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
            'no-var': 'error',
            'prefer-const': 'error',
            eqeqeq: ['error', 'always'],
            curly: ['error', 'all'],
            'no-throw-literal': 'error',
        },
    },
    {
        files: ['tests/load/**/*.js'],
        languageOptions: {
            sourceType: 'module',
            globals: { __ENV: 'readonly' },
        },
    },
];
