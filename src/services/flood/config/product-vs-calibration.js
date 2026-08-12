'use strict';

/**
 * Product / calibration mode gating (architecture doc §19).
 *
 * - PRODUCT runs: normal application mode. Diagnostics are minimal, outputs
 *   are publication-eligible.
 * - CALIBRATION runs: scientific / admin mode. Extra diagnostics, extra QA.
 *   Outputs are NEVER auto-published — an admin must explicitly publish a
 *   PRODUCT rerun instead. This preserves the reproducibility contract §84.
 *
 * Every call site that touches the publish flow should check
 * `canAutoPublish(run)` before persisting a `published` artifact status.
 */

const { RUN_MODES } = require('./defaults');

const isProduct = (run) => run?.mode === 'product';
const isCalibration = (run) => run?.mode === 'calibration';

const assertValidMode = (mode) => {
    if (!RUN_MODES.includes(mode)) {
        throw new Error(
            `Unsupported flood run mode: '${mode}'. Expected one of ${RUN_MODES.join(', ')}`,
        );
    }
};

/**
 * Return true iff the run is eligible to auto-publish artifacts. Calibration
 * runs and non-succeeded runs are never eligible; the admin can still publish
 * calibration artifacts explicitly if scientifically warranted, but that path
 * emits a distinct audit event.
 *
 * @param {object} run — { mode, status }
 * @returns {boolean}
 */
const canAutoPublish = (run) => {
    if (!run || run.mode !== 'product') {return false;}
    if (run.status && run.status !== 'SUCCEEDED') {return false;}
    return true;
};

/**
 * Return true iff an artifact is publish-eligible at all — includes calibration
 * artifacts that an admin may still publish manually.
 */
const canManuallyPublish = (artifact) => {
    if (!artifact) {return false;}
    // architecture doc §69: calibration artifacts require a distinct approval
    // path; here we only expose whether *any* publication is theoretically
    // allowed for this artifact_role.
    return ['PRODUCT', 'QA'].includes(artifact.artifact_role);
};

/**
 * Whether the run should engage the heavier diagnostic modules
 * (services/flood/diagnostics/*).
 */
const shouldEnableDiagnostics = (run) => isCalibration(run);

module.exports = {
    isProduct,
    isCalibration,
    assertValidMode,
    canAutoPublish,
    canManuallyPublish,
    shouldEnableDiagnostics,
};
