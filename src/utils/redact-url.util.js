'use strict';

const SENSITIVE_QUERY_VALUE =
    /([?&](?:ticket|access_token|refresh_token|token|code|x-amz-signature|x-amz-credential|x-amz-security-token)=)[^&#]*/gi;

const redactSensitiveUrl = (value) =>
    String(value || '').replace(SENSITIVE_QUERY_VALUE, '$1[REDACTED]');

module.exports = { redactSensitiveUrl };
