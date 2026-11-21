'use strict';

jest.mock('firebase-admin', () => {
    const messaging = {
        sendEachForMulticast: jest.fn(),
        send: jest.fn(),
    };
    return {
        apps: [],
        credential: { applicationDefault: jest.fn() },
        initializeApp: jest.fn(),
        messaging: jest.fn(() => messaging),
    };
});

const credentialKeys = [
    'PUSH_ENABLED',
    'FIREBASE_SERVICE_ACCOUNT_BASE64',
    'FIREBASE_SERVICE_ACCOUNT',
    'GOOGLE_APPLICATION_CREDENTIALS',
];
let originalEnv;
let provider;
let messaging;

describe('FCM data serialization', () => {
    beforeEach(() => {
        jest.resetModules();
        originalEnv = Object.fromEntries(credentialKeys.map((key) => [key, process.env[key]]));
        credentialKeys.forEach((key) => delete process.env[key]);
        process.env.GOOGLE_APPLICATION_CREDENTIALS = 'mocked-credentials.json';
        jest.spyOn(console, 'log').mockImplementation(() => {});
        const admin = require('firebase-admin');
        messaging = admin.messaging();
        messaging.send.mockResolvedValue('mock-message-id');
        messaging.sendEachForMulticast.mockResolvedValue({
            successCount: 1,
            failureCount: 0,
            responses: [{ success: true }],
        });
        provider = require('../pushProvider.util');
    });

    afterEach(() => {
        credentialKeys.forEach((key) => {
            if (originalEnv[key] === undefined) {
                delete process.env[key];
            } else {
                process.env[key] = originalEnv[key];
            }
        });
        jest.restoreAllMocks();
    });

    test.each(['tokens', 'topic'])(
        '%s delivery omits top-level missing/nonfinite fields and preserves valid data',
        async (destination) => {
            const data = {
                missing: null,
                absent: undefined,
                notANumber: NaN,
                positiveInfinity: Infinity,
                negativeInfinity: -Infinity,
                count: 0,
                enabled: false,
                distance: 12.5,
                referenceCode: 'CP-4',
                empty: '',
                literalNull: 'null',
                detail: { count: 0, enabled: false, missing: null },
                values: [0, false, null],
            };
            const original = { ...data };
            const notification = { title: 'Test title', body: 'Test body', data };

            if (destination === 'tokens') {
                await expect(provider.sendToTokens(['test-token'], notification)).resolves.toEqual({
                    successCount: 1,
                    failureCount: 0,
                    invalidTokens: [],
                });
            } else {
                await expect(provider.sendToTopic('test-topic', notification)).resolves.toBe(true);
            }

            const send = destination === 'tokens' ? messaging.sendEachForMulticast : messaging.send;
            expect(send).toHaveBeenCalledTimes(1);
            expect(send).toHaveBeenCalledWith({
                ...(destination === 'tokens'
                    ? { tokens: ['test-token'] }
                    : { topic: 'test-topic' }),
                notification: { title: 'Test title', body: 'Test body' },
                data: {
                    count: '0',
                    enabled: 'false',
                    distance: '12.5',
                    referenceCode: 'CP-4',
                    empty: '',
                    literalNull: 'null',
                    detail: '{"count":0,"enabled":false,"missing":null}',
                    values: '[0,false,null]',
                },
            });
            expect(data).toEqual(original);
        },
    );
});
