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

const getLatestSuccessfulByPeriod = async (year, month) => {
    const { rows } = await db.query(
        `SELECT * FROM forest.forest_snapshots
         WHERE year = $1
           AND month = $2
           AND gee_download_url IS NOT NULL
           AND status IN ('exporting', 'completed', 'published')
         ORDER BY attempt DESC, id DESC
         LIMIT 1`,
        [year, month],
    );
    return rows[0] || null;
};

const listActiveRuns = async () => {
    const { rows } = await db.query(
        `SELECT *
           FROM forest.forest_snapshots
          WHERE status IN ('pending', 'computing', 'exporting')
          ORDER BY id ASC`,
    );
    return rows;
};

const createRun = async ({ year, month, trigger, requestedBy, modelParams = {} }) => {
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
            `INSERT INTO forest.forest_snapshots (year, month, attempt, status, trigger, requested_by, model_params)
             VALUES ($1, $2, $3, 'pending', $4, $5, $6::jsonb)
             RETURNING *`,
            [
                year,
                month,
                attempt.rows[0].attempt,
                trigger,
                requestedBy || null,
                JSON.stringify(modelParams || {}),
            ],
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
        s2_image_count: patch.s2ImageCount,
        duration_ms: patch.durationMs,
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
    if (!assignments.length) {
        return getById(id);
    }
    const { rows } = await db.query(
        `UPDATE forest.forest_snapshots SET ${assignments.join(', ')} WHERE id = $1 RETURNING *`,
        values,
    );
    return rows[0] || null;
};

const listRuns = async ({ page = 1, limit = 24, publishedOnly = false } = {}) => {
    const offset = (page - 1) * limit;
    const where = publishedOnly ? "WHERE status = 'published' OR geoserver_layer IS NOT NULL" : '';
    const { rows } = await db.query(
        `WITH latest_by_period AS (
             SELECT DISTINCT ON (s.year, s.month) s.*
               FROM forest.forest_snapshots s
               ${where}
              ORDER BY s.year DESC, s.month DESC, s.attempt DESC, s.id DESC
         )
         SELECT latest_by_period.*, COUNT(*) OVER()::int AS total_count
           FROM latest_by_period
          ORDER BY year DESC, month DESC
          LIMIT $1 OFFSET $2`,
        [limit, offset],
    );
    return {
        items: rows.map(({ total_count: _totalCount, ...item }) => item),
        total: Number(rows[0]?.total_count || 0),
    };
};

module.exports = {
    getById,
    getLatest,
    getLatestCompleted,
    getByPeriod,
    getLatestSuccessfulByPeriod,
    listActiveRuns,
    createRun,
    updateRun,
    listRuns,
};
