'use strict';

const fs = require('fs');
const path = require('path');

const OVERRIDE_FILE = path.resolve(__dirname, '../../../data/flood-legends-overrides.json');

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

function getOverrides() {
    return _read();
}

function getOverride(artifactCode) {
    return _read()[artifactCode] ?? null;
}

/**
 * Merge patch fields into the override for artifactCode.
 * Only palette, min, max, label are accepted.
 */
function upsertOverride(artifactCode, patch) {
    const all = _read();
    const existing = all[artifactCode] ?? {};
    const allowed = {};
    if (patch.palette !== undefined) allowed.palette = patch.palette;
    if (patch.min !== undefined) allowed.min = patch.min;
    if (patch.max !== undefined) allowed.max = patch.max;
    if (patch.label !== undefined) allowed.label = patch.label;
    all[artifactCode] = { ...existing, ...allowed };
    _write(all);
    return all[artifactCode];
}

/**
 * Remove override for an artifact_code (reset to defaults).
 */
function deleteOverride(artifactCode) {
    const all = _read();
    delete all[artifactCode];
    _write(all);
}

module.exports = { getOverrides, getOverride, upsertOverride, deleteOverride };
