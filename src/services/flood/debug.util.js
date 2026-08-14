'use strict';

/**
 * Verbose logger for the flood pipeline.
 *
 * On/off via `FLOOD_DEBUG` env (checked per call, so ops can flip it during a
 * live diagnosis without restarting). When off, every helper is a no-op and
 * costs one env read.
 *
 * Prefix `[FLOOD-DEBUG]` makes it grep-friendly in mixed logs. Meta values are
 * JSON-serialised with URL/secret redaction so we don't leak signed GCS URLs
 * or service-key fragments into console output that ops copy-pastes.
 */

const { isDebugEnabled } = require('../../configs/flood');

const REDACT_PATTERNS = [
    { re: /https?:\/\/\S+/gi, sub: '[redacted-url]' },
    { re: /(private_key|client_secret|token|ticket|signature)=?[^&\s"']*/gi, sub: '$1=[redacted]' },
    { re: /X-Amz-[A-Za-z-]+=[^&\s"']+/g, sub: 'X-Amz-*=[redacted]' },
];

function redact(value) {
    if (value === null || value === undefined) {
        return value;
    }
    if (typeof value === 'string') {
        let out = value;
        for (const { re, sub } of REDACT_PATTERNS) {
            out = out.replace(re, sub);
        }
        return out.length > 400 ? `${out.slice(0, 397)}...` : out;
    }
    if (Array.isArray(value)) {
        return value.map(redact);
    }
    if (typeof value === 'object') {
        const out = {};
        for (const [key, v] of Object.entries(value)) {
            out[key] = redact(v);
        }
        return out;
    }
    return value;
}

function format(meta) {
    if (!meta) {
        return '';
    }
    try {
        return ` ${JSON.stringify(redact(meta))}`;
    } catch {
        return ' [meta-serialize-failed]';
    }
}

/** One-shot log. No-op when FLOOD_DEBUG=false. */
function log(stage, meta) {
    if (!isDebugEnabled()) {
        return;
    }
    console.log(`[FLOOD-DEBUG] ${stage}${format(meta)}`);
}

/** Errors get logged even when debug is off — but with the same prefix. */
function logError(stage, error, meta) {
    console.error(
        `[FLOOD-DEBUG] ${stage} ERROR: ${error?.code || ''} ${error?.message || error}`.trim(),
        format(meta) ? format(meta) : '',
    );
}

/**
 * Create a scoped logger tagged with a run/artifact context so downstream
 * logs auto-include the ids. `scope('runId=123 module=event')` yields
 * `[FLOOD-DEBUG] runId=123 module=event | <stage> <meta>`.
 */
function scope(prefix) {
    return {
        log(stage, meta) {
            log(`${prefix} | ${stage}`, meta);
        },
        error(stage, error, meta) {
            logError(`${prefix} | ${stage}`, error, meta);
        },
        timer(stage, meta) {
            return timer(`${prefix} | ${stage}`, meta);
        },
    };
}

/**
 * Time a block. Call the returned `end(extraMeta)` when done — logs
 * elapsed_ms alongside any extra fields.
 */
function timer(stage, meta) {
    if (!isDebugEnabled()) {
        return { end() {} };
    }
    const started = Date.now();
    log(`${stage} start`, meta);
    return {
        end(extra) {
            log(`${stage} end`, { elapsed_ms: Date.now() - started, ...extra });
        },
    };
}

module.exports = {
    log,
    logError,
    scope,
    timer,
    isDebugEnabled,
    // exposed for tests
    __redact: redact,
};
