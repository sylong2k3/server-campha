'use strict';

/**
 * Run-scoped diagnostic accumulator (calibration mode only).
 *
 * The reference project holds a single module-level `DIAG_STORE` dictionary
 * (Flood_D:264). That would violate the §18 no-global-state rule for our
 * concurrent-run design — so instead every calibration run creates its OWN
 * store via `createDiagnosticStore()`.
 *
 * Diagnostics collected during a run are serialised into the
 * `gis.flood_run_stage_events.detail` JSONB column via the orchestrator; this
 * module is just the in-memory intermediate accumulator.
 *
 * @source docs/Flood_D_final.js (`diagStore`:269, `DIAG_STORE`:264)
 * @rule   architecture doc §18 (no global mutable state)
 * @rule   §19 diagnostics only run when mode==='calibration'
 */

function createDiagnosticStore() {
    // We use a Map so key insertion order is preserved for admin dashboards
    // that render the diagnostic trace in emission order.
    const entries = new Map();

    return {
        /**
         * Append `{ prefix, key: value }` pairs, tagged with an ISO timestamp.
         * Same prefix can be recorded multiple times — each call adds a row.
         */
        put(prefix, obj) {
            if (typeof prefix !== 'string' || !prefix.trim()) {
                throw new Error('diagnostics.store.put requires a non-empty prefix');
            }
            const ts = new Date().toISOString();
            const rowId = `${prefix}#${entries.size}`;
            entries.set(rowId, {
                emittedAt: ts,
                prefix,
                detail: obj === null || obj === undefined ? {} : obj,
            });
            return rowId;
        },

        /**
         * Return every accumulated entry, oldest first. Safe to call any time.
         */
        snapshot() {
            return Array.from(entries.values());
        },

        /**
         * Convenience: return a JSON-serialisable summary suitable for the
         * flood_run_stage_events.detail column.
         */
        toJSON() {
            return { entries: this.snapshot(), size: entries.size };
        },

        /**
         * Clear all accumulated entries. Rarely used — most callers create a
         * fresh store per run and let it go out of scope.
         */
        clear() {
            entries.clear();
        },

        size() {
            return entries.size;
        },
    };
}

module.exports = { createDiagnosticStore };
