'use strict';

const fs = require('fs');
const path = require('path');

const OVERRIDE_FILE = path.resolve(__dirname, '../../../data/flood-config-overrides.json');

function _read() {
    try {
        return JSON.parse(fs.readFileSync(OVERRIDE_FILE, 'utf8'));
    } catch {
        return {};
    }
}

function _write(data) {
    fs.writeFileSync(OVERRIDE_FILE, JSON.stringify(data, null, 2), 'utf8');
}

/** Returns the full override map {key: value}. */
function getOverrides() {
    return _read();
}

/**
 * Merge patch keys into stored overrides.
 * Only keys that exist in TREND_FINAL_DEFAULTS are accepted (enforced by the
 * caller before writing).
 */
function upsertOverrides(patch) {
    const all = _read();
    const next = { ...all, ...patch };
    _write(next);
    return next;
}

/**
 * Remove a single key override (reset to base default).
 * If key is null/undefined, clears all overrides.
 */
function deleteOverride(key) {
    const all = _read();
    if (key == null) {
        _write({});
        return {};
    }
    delete all[key];
    _write(all);
    return all;
}

module.exports = { getOverrides, upsertOverrides, deleteOverride };
