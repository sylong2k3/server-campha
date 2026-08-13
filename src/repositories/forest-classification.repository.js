'use strict';

const db = require('../configs/database');

const getById = async (id) => {
    const { rows } = await db.query('SELECT * FROM forest.forest_snapshots WHERE id = $1', [id]);
    return rows[0] || null;
};

const getLatest = async () => {
    const { rows } = await db.query(
        'SELECT * FROM forest.forest_snapshots ORDER BY year DESC, month DESC, attempt DESC LIMIT 1',
    );
    return rows[0] || null;
};

const getLatestCompleted = async () => {
    const { rows } = await db.query(
        `SELECT * FROM forest.forest_snapshots
         WHERE status IN ('completed', 'published')
         ORDER BY year DESC, month DESC, attempt DESC LIMIT 1`,
    );
    return rows[0] || null;
};

const getByPeriod = async (year, month) => {
    const { rows } = await db.query(
        `SELECT * FROM forest.forest_snapshots
         WHERE year = $1 AND month = $2
         ORDER BY attempt DESC LIMIT 1`,
        [year, month],
    );
    return rows[0] || null;
};

const createRun = async ({ year, month, trigger, requestedBy }) => {
    const client = await db.pool.connect();
    try {
        await client.query('BEGIN');
        const live = await client.query(
            `SELECT * FROM forest.forest_snapshots
             WHERE year = $1 AND month = $2 AND status IN ('pending','computing','exporting')
             FOR UPDATE`,
            [year, month],
        );
        if (live.rows[0]) {
            await client.query('COMMIT');
            return { snapshot: live.rows[0], deduplicated: true };
        }
        const attempt = await client.query(
            'SELECT COALESCE(MAX(attempt), 0) + 1 AS attempt FROM forest.forest_snapshots WHERE year = $1 AND month = $2',
            [year, month],
        );
        const inserted = await client.query(
            `INSERT INTO forest.forest_snapshots (year, month, attempt, status, trigger, requested_by)
             VALUES ($1, $2, $3, 'pending', $4, $5)
             RETURNING *`,
            [year, month, attempt.rows[0].attempt, trigger, requestedBy || null],
        );
        await client.query('COMMIT');
        return { snapshot: inserted.rows[0], deduplicated: false };
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
};

const updateRun = async (id, patch = {}) => {
    const fields = {
        status: patch.status,
        province_summary: patch.provinceSummary,
        gee_tile_url: patch.geeTileUrl,
        gee_tile_generated_at: patch.geeTileUrl ? new Date() : undefined,
        gee_download_url: patch.geeDownloadUrl,
        error_message: patch.errorMessage,
        computed_at: patch.computedAt,
    };
    const assignments = [];
    const values = [id];
    Object.entries(fields).forEach(([column, value]) => {
        if (value !== undefined) {
            values.push(column === 'province_summary' ? JSON.stringify(value) : value);
            assignments.push(
                `${column} = $${values.length}${column === 'province_summary' ? '::jsonb' : ''}`,
            );
        }
    });
    if (!assignments.length) {return getById(id);}
    const { rows } = await db.query(
        `UPDATE forest.forest_snapshots SET ${assignments.join(', ')} WHERE id = $1 RETURNING *`,
        values,
    );
    return rows[0] || null;
};

const listRuns = async ({ page = 1, limit = 24, publishedOnly = false } = {}) => {
    const offset = (page - 1) * limit;
    const where = publishedOnly ? "WHERE s.status = 'published' OR s.geoserver_layer IS NOT NULL" : '';
    const { rows } = await db.query(
        `SELECT s.*,
                COUNT(DISTINCT da.id)::int AS district_total,
                COUNT(DISTINCT de.id) FILTER (WHERE de.geoserver_layer IS NOT NULL)::int AS district_geoserver_count,
                COALESCE(array_agg(DISTINCT de.geoserver_layer) FILTER (WHERE de.geoserver_layer IS NOT NULL), '{}') AS geoserver_layers,
                COUNT(*) OVER()::int AS total_count
           FROM forest.forest_snapshots s
           LEFT JOIN forest.forest_district_areas da ON da.snapshot_id = s.id
           LEFT JOIN forest.forest_district_exports de ON de.snapshot_id = s.id
           ${where}
          GROUP BY s.id
          ORDER BY s.year DESC, s.month DESC, s.attempt DESC
          LIMIT $1 OFFSET $2`,
        [limit, offset],
    );
    return {
        items: rows.map(({ total_count: _totalCount, ...item }) => item),
        total: Number(rows[0]?.total_count || 0),
    };
};

const getDistrictAreas = async (snapshotId) => {
    const { rows } = await db.query(
        `SELECT district_code AS "districtCode", district_name AS "districtName",
                jsonb_agg(jsonb_build_object(
                    'classId', class_id, 'className', class_name, 'areaHa', area_ha
                ) ORDER BY class_id) AS classes
           FROM forest.forest_district_areas
          WHERE snapshot_id = $1
          GROUP BY district_code, district_name
          ORDER BY district_name NULLS LAST, district_code NULLS LAST`,
        [snapshotId],
    );
    return rows;
};

const listDistrictExports = async (snapshotId) => {
    const { rows } = await db.query(
        `SELECT de.*, rij.status AS raster_ingest_status
           FROM forest.forest_district_exports de
           LEFT JOIN gis.raster_ingest_jobs rij ON rij.id = de.raster_ingest_job_id
          WHERE de.snapshot_id = $1
          ORDER BY de.district_name NULLS LAST, de.district_code`,
        [snapshotId],
    );
    return rows;
};

module.exports = {
    getById,
    getLatest,
    getLatestCompleted,
    getByPeriod,
    createRun,
    updateRun,
    listRuns,
    getDistrictAreas,
    listDistrictExports,
};
