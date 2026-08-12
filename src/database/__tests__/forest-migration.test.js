'use strict';

const fs = require('fs');
const path = require('path');

const sql = fs.readFileSync(
    path.join(__dirname, '..', 'migrations', '083_forest_classification_domain.sql'),
    'utf8',
);

describe('083 Forest Classification domain', () => {
    test('creates the snapshot, district raster and ground-truth tables', () => {
        for (const table of [
            'forest.forest_snapshots',
            'forest.forest_district_areas',
            'forest.forest_district_exports',
            'forest.forest_gt_zones',
            'forest.forest_gt_points',
        ]) {
            expect(sql).toContain(`CREATE TABLE IF NOT EXISTS ${table}`);
        }
    });

    test('preserves the 13-class 0..12 taxonomy at persistence boundaries', () => {
        expect(sql.match(/class_id BETWEEN 0 AND 12/g)).toHaveLength(3);
    });

    test('enforces one live attempt per period and immutable attempt history', () => {
        expect(sql).toContain('UNIQUE (year, month, attempt)');
        expect(sql).toMatch(/uq_forest_one_live_period[\s\S]*?WHERE status IN/);
    });

    test('links district publication to the canonical raster ingest queue', () => {
        expect(sql).toContain('REFERENCES gis.raster_ingest_jobs(id)');
        expect(sql).toContain("'published'");
    });

    test('grants current Cẩm Phả roles without restoring legacy role codes', () => {
        for (const role of ['system_admin', 'so_tnmt', 'ubnd_tp', 'so_xd', 'citizen']) {
            expect(sql).toContain(`'${role}'`);
        }
        expect(sql).not.toContain('so_nnmt');
        expect(sql).not.toContain('ubnd_tinh');
    });

    test('does not recreate the removed Fire Risk domain', () => {
        expect(sql.toLowerCase()).not.toContain('fire_risk');
    });
});
