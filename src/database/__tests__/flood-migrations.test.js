'use strict';

const fs = require('fs');
const path = require('path');

const migrationsDir = path.join(__dirname, '..', 'migrations');
const load = (name) =>
    fs.readFileSync(path.join(migrationsDir, name), 'utf8');

describe('flood migrations (GEE-S05 §7.1)', () => {
    describe('080_flood_domain.sql', () => {
        const sql = load('080_flood_domain.sql');

        test('creates all four gis.flood_* tables', () => {
            for (const table of [
                'gis.flood_analysis_runs',
                'gis.flood_artifacts',
                'gis.flood_run_stage_events',
                'gis.flood_run_audit',
            ]) {
                expect(sql).toMatch(new RegExp(`CREATE TABLE IF NOT EXISTS ${table.replace('.', '\\.')}\\s`));
            }
        });

        test('flood_analysis_runs enforces the 11-state status enum', () => {
            for (const state of [
                'QUEUED',
                'COMPUTING',
                'EXPORTING',
                'HARVESTING',
                'VALIDATING',
                'ARCHIVING',
                'PUBLISHING',
                'SUCCEEDED',
                'FAILED',
                'CANCELLED',
                'DLQ',
            ]) {
                expect(sql).toContain(`'${state}'`);
            }
        });

        test('flood_analysis_runs enforces module + mode enums', () => {
            expect(sql).toContain(
                "module IN ('event', 'hand', 'rain', 'impact', 'trend')",
            );
            expect(sql).toContain("mode IN ('product', 'calibration')");
        });

        test('flood_analysis_runs uniqueness is (analysis_key, attempt_no)', () => {
            expect(sql).toContain('UNIQUE (analysis_key, attempt_no)');
        });

        test('flood_analysis_runs records aoi_source per architecture §82', () => {
            expect(sql).toContain(
                "aoi_source IN ('REFERENCE_GAUL', 'AUTHORITATIVE')",
            );
        });

        test('flood_artifacts enforces artifact_role enum + sha256 pattern', () => {
            expect(sql).toContain(
                "artifact_role IN ('PRODUCT', 'QA', 'CALIBRATION')",
            );
            expect(sql).toContain("checksum_sha256 ~ '^[0-9a-f]{64}$'");
        });

        test('flood_artifacts publish_status defaults to unpublished with a bounded enum', () => {
            expect(sql).toContain(
                "publish_status IN ('unpublished', 'publishing', 'published', 'failed')",
            );
        });

        test('flood_artifacts enforces uniqueness of (run, artifact_code) per §39 immutability', () => {
            expect(sql).toMatch(/UNIQUE INDEX IF NOT EXISTS uq_flood_artifacts_run_code/);
        });

        test('flood_run_stage_events enforces event_type enum', () => {
            expect(sql).toContain(
                "event_type IN ('stage_start', 'stage_end', 'stage_error', 'stage_warn')",
            );
        });

        test('flood_run_audit action enum covers all §8.2 admin verbs', () => {
            for (const action of [
                'submit',
                'rerun',
                'cancel',
                'publish',
                'unpublish',
                'retry_publish',
                'discard_artifact',
            ]) {
                expect(sql).toContain(`'${action}'`);
            }
        });
    });

    describe('081_raster_ingest.sql', () => {
        const sql = load('081_raster_ingest.sql');

        test('creates gis.raster_ingest_jobs and gis.raster_ingest_dlq (§22-D)', () => {
            expect(sql).toContain('CREATE TABLE IF NOT EXISTS gis.raster_ingest_jobs');
            expect(sql).toContain('CREATE TABLE IF NOT EXISTS gis.raster_ingest_dlq');
        });

        test('raster_ingest_jobs status enum includes url_expired and dlq terminal states', () => {
            for (const state of [
                'pending',
                'downloading',
                'validating',
                'uploading',
                'publishing',
                'completed',
                'failed',
                'url_expired',
                'dlq',
            ]) {
                expect(sql).toContain(`'${state}'`);
            }
        });

        test('layer_code CHECK matches enqueue.js VALID_LAYER_CODE regex', () => {
            expect(sql).toContain("layer_code ~ '^[a-z][a-z0-9_-]{1,58}$'");
        });

        test('source_hash + file_sha256 both enforce 64-char lowercase hex', () => {
            expect(sql).toContain("source_hash ~ '^[0-9a-f]{64}$'");
            expect(sql).toContain("file_sha256 ~ '^[0-9a-f]{64}$'");
        });

        test('dedupe index on source_hash is partial over active states', () => {
            expect(sql).toMatch(
                /UNIQUE INDEX IF NOT EXISTS uq_raster_ingest_active_hash[\s\S]*?WHERE status IN/,
            );
        });

        test('claim index is partial on status=pending (used by FOR UPDATE SKIP LOCKED)', () => {
            expect(sql).toMatch(/idx_raster_ingest_claim[\s\S]*?WHERE status = 'pending'/);
        });

        test('DLQ reason enum covers all retry-policy branches', () => {
            for (const reason of [
                'MAX_RETRIES_EXCEEDED',
                'NON_RETRYABLE',
                'INTERRUPTED_ON_RESTART',
                'INVALID_ARTIFACT',
                'UNSUPPORTED_CRS',
                'MANUAL_DISCARD',
            ]) {
                expect(sql).toContain(`'${reason}'`);
            }
        });

        test('updated_at trigger wires to core.update_updated_at_column()', () => {
            expect(sql).toContain('core.update_updated_at_column()');
        });
    });
});
