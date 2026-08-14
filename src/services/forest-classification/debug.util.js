'use strict';

/**
 * Verbose logger for the forest classification pipeline.
 *
 * On/off via `FOREST_DEBUG` env (checked per call, so ops can flip it during a
 * live diagnosis without restarting). When off, log() is a no-op that costs
 * one env read; logError() always prints so real failures stay visible.
 *
 * Prefix `[FOREST-DEBUG]` makes it grep-friendly in mixed logs. Meta values
 * are JSON-serialised with URL/secret redaction so we don't leak GEE signed
 * URLs or service-key fragments into console output.
 *
 * Mirrors services/flood/debug.util.js — same shape so both domains behave
 * the same way for on-call.
 */

const isDebugEnabled = () => String(process.env.FOREST_DEBUG || 'false').toLowerCase() === 'true';

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

function log(stage, meta) {
    if (!isDebugEnabled()) {
        return;
    }
    console.log(`[FOREST-DEBUG] ${stage}${format(meta)}`);
}

function logError(stage, error, meta) {
    console.error(
        `[FOREST-DEBUG] ${stage} ERROR: ${error?.code || ''} ${error?.message || error}`.trim(),
        format(meta) ? format(meta) : '',
    );
}

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
    timer,
    isDebugEnabled,
    __redact: redact,
};
