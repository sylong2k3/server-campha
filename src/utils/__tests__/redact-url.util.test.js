'use strict';

const { redactSensitiveUrl } = require('../redact-url.util');

describe('redactSensitiveUrl', () => {
    test('redacts download tickets and SigV4 credentials without changing ordinary query values', () => {
        expect(
            redactSensitiveUrl(
                '/campha-documents/a.pdf?page=2&X-Amz-Credential=campha%2Fscope&X-Amz-Signature=secret&ticket=jwt',
            ),
        ).toBe(
            '/campha-documents/a.pdf?page=2&X-Amz-Credential=[REDACTED]&X-Amz-Signature=[REDACTED]&ticket=[REDACTED]',
        );
    });

    test('handles empty values', () => {
        expect(redactSensitiveUrl()).toBe('');
    });
});
